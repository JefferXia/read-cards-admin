import { prisma } from './db'

const DAY_MS = 24 * 60 * 60 * 1000

/** 一天的边界（服务器时区；部署在国内即北京时间） */
export function dayStart(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 日期键：YYYY-MM-DD（本地时区） */
export function dateKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function newCardsCap(): number {
  return Number(process.env.DAILY_NEW_CARDS ?? 6)
}

/** 单次复习队列上限（复习只做一遍，队列逐张过完即止） */
export function reviewDueCap(): number {
  return Number(process.env.REVIEW_DUE_CAP ?? 3)
}

/** 入册后的首次复习到期时间：次日（约 20 小时后） */
export function initialDue(now = new Date()): Date {
  return new Date(now.getTime() + 20 * 60 * 60 * 1000)
}

export async function activeBook() {
  return prisma.book.findFirst({ where: { status: 'ACTIVE' }, include: { chapters: true } })
}

/** 用户在某本书是否还有未学的 APPROVED 卡（决定是否续读该书） */
export async function bookHasRemaining(userId: string, bookId: string): Promise<boolean> {
  const remaining = await prisma.card.count({
    where: {
      chapter: { bookId },
      status: 'APPROVED',
      cardStates: { none: { userId } },
    },
  })
  return remaining > 0
}

/**
 * 用户今日应读的书（书单连续性，逐日链式传递）：
 * 1. 最近一次领取的书：今天领的直接用；非今天的，若该书还有未学卡则续读
 *    （运营切换全局活跃书不影响在读用户，读完前一本才进新书）。
 * 2. 无领取记录 / 前一本已读完 → 当前全局活跃书。
 */
export async function resolveBook(userId: string) {
  const last = await prisma.dailyClaim.findFirst({
    where: { userId, bookId: { not: null } },
    orderBy: [{ claimDate: 'desc' }, { createdAt: 'desc' }],
    select: { bookId: true, claimDate: true },
  })
  if (last?.bookId) {
    const book = await prisma.book.findUnique({ where: { id: last.bookId }, include: { chapters: true } })
    if (book && (last.claimDate === dateKey() || (await bookHasRemaining(userId, book.id)))) {
      return book
    }
  }
  return activeBook()
}

/**
 * 线性解锁：第 0 章恒解锁；第 k 章解锁 ⇔ 第 k-1 章全部卡片均已有 CardState
 * 返回：章 idx → 是否解锁 的数组，以及用户已学卡集合
 */
export async function chapterUnlockMap(userId: string, bookId: string) {
  const chapters = await prisma.chapter.findMany({
    where: { bookId },
    orderBy: { idx: 'asc' },
    include: { cards: { select: { id: true } } },
  })
  const states = await prisma.cardState.findMany({
    where: { userId, card: { chapter: { bookId } } },
    select: { cardId: true },
  })
  const learned = new Set(states.map((s) => s.cardId))

  const unlocked: number[] = []
  for (const ch of chapters) {
    const prev = chapters.find((c) => c.idx === ch.idx - 1)
    const ok = ch.idx === 0 || (prev ? prev.cards.every((c) => learned.has(c.id)) : true)
    if (ok) unlocked.push(ch.idx)
    else break // 线性：一旦断档后面全部未解锁
  }
  return { chapters, learned, unlockedIdxs: unlocked }
}

/** 每日最少阅读张数（两章不足时向下补齐到此值） */
export function dailyMinCards(): number {
  return Number(process.env.DAILY_NEW_CARDS ?? 6)
}

/**
 * 今日阅读计划：从未读完的章节起，连续取两个章节；
 * 若两章卡片总数不足 dailyMinCards，继续向后补章直到达标（或书读完）。
 * 计划包含这些章节的全部已上架卡（含已学，用于前端展示勾/圈）。
 */
export async function todayPlan(userId: string, bookId: string) {
  const { learned, unlockedIdxs } = await chapterUnlockMap(userId, bookId)

  // 带完整卡信息查解锁章节
  const full = await prisma.chapter.findMany({
    where: { bookId, idx: { in: unlockedIdxs } },
    orderBy: { idx: 'asc' },
    include: {
      cards: { where: { status: 'APPROVED' }, orderBy: { idx: 'asc' } },
    },
  })

  const picked: typeof full = []
  let count = 0
  for (const ch of full) {
    const unlearnedInCh = ch.cards.filter((c) => !learned.has(c.id)).length
    if (unlearnedInCh === 0) continue // 本章节已读完，跳过
    picked.push(ch)
    count += ch.cards.length
    if (picked.length >= 2 && count >= dailyMinCards()) break
  }

  const cards = picked.flatMap((ch) =>
    ch.cards.map((c) => ({
      id: c.id,
      module: ch.title,
      title: c.title,
      subtitle: '',
      quote: c.quote,
      source: c.source ?? '',
      recast: c.recast,
      trigger: c.trigger,
      boundaries: c.boundaries.join('\n'),
      learned: learned.has(c.id),
    })),
  )
  return { cards, target: count, pickedChapters: picked.map((c) => c.title) }
}

/**
 * 每日领取（打卡）统计：今天是否已领 + 连续领取天数
 * 连续口径：从今天（今天未领则从昨天）往回数连续领取的天数，漏一天归零。
 */
export async function claimStats(userId: string) {
  const claims = await prisma.dailyClaim.findMany({
    where: { userId },
    orderBy: { claimDate: 'desc' },
    take: 400,
    select: { claimDate: true },
  })
  const dates = new Set(claims.map((c) => c.claimDate))

  const now = new Date()
  const claimedToday = dates.has(dateKey(now))
  let cursor = claimedToday ? now : new Date(now.getTime() - DAY_MS)
  let streakDays = 0
  while (dates.has(dateKey(cursor))) {
    streakDays++
    cursor = new Date(cursor.getTime() - DAY_MS)
  }
  return { claimedToday, streakDays }
}
