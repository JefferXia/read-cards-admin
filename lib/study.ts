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
 * 今日阅读计划：每天固定 newCardsCap() 张（DAILY_NEW_CARDS）。
 * 未学卡按章节顺序顺位取；今天已学的卡保留在计划里（前端展示勾），
 * 学一张少一张待学、不后移，计划当天稳定。书余量不足时有多少取多少。
 */
export async function todayPlan(userId: string, bookId: string) {
  const cap = newCardsCap()
  const dayStartAt = dayStart()
  const [states, cards] = await Promise.all([
    prisma.cardState.findMany({
      where: { userId, card: { chapter: { bookId } } },
      select: { cardId: true, createdAt: true },
    }),
    prisma.card.findMany({
      where: { chapter: { bookId }, status: 'APPROVED' },
      orderBy: [{ chapter: { idx: 'asc' } }, { idx: 'asc' }],
      include: { chapter: { select: { title: true } } },
    }),
  ])
  const learnedAt = new Map(states.map((s) => [s.cardId, s.createdAt]))

  const picked = cards
    .filter((c) => {
      const at = learnedAt.get(c.id)
      return at === undefined || at >= dayStartAt // 旧日已学排除，今天学的保留
    })
    .slice(0, cap)

  const cardsOut = picked.map((c) => ({
    id: c.id,
    module: c.module,
    title: c.title,
    subtitle: c.definition,
    quote: c.quote,
    source: c.source ?? '',
    recast: c.recast,
    trigger: c.trigger,
    boundaries: c.boundaries.join('\n'),
    learned: learnedAt.has(c.id),
  }))
  return {
    cards: cardsOut,
    target: cardsOut.length,
    pickedChapters: [...new Set(picked.map((c) => c.chapter.title))],
  }
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
