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
      bookId,
      status: 'APPROVED',
      cardStates: { none: { userId } },
    },
  })
  return remaining > 0
}

/**
 * 用户今日应读的书（默认书单，书单连续性，逐日链式传递）：
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
 * 领取时锁定的今日书目：请求明确带 bookId（刷新书单选中的书）且该书还有未学卡
 * 就切到它——换书以「领取」为确认动作，领取后记入书单表（UserBook，去重）；
 * 没带 / 书不存在 / 已读完，都回落默认书单 resolveBook（claim 链，未读完续读）。
 */
export async function claimBook(userId: string, wantedBookId?: string) {
  if (wantedBookId) {
    const book = await prisma.book.findUnique({ where: { id: wantedBookId }, include: { chapters: true } })
    if (book && (await bookHasRemaining(userId, book.id))) return book
  }
  return resolveBook(userId)
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
      where: { userId, card: { bookId } },
      select: { cardId: true, createdAt: true },
    }),
    prisma.card.findMany({
      where: { bookId, status: 'APPROVED' },
      orderBy: { sortOrder: 'asc' }, // 数据源 JSON 顺序（入库序），与章节无关
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
    pickedChapters: [
      ...new Set(
        picked
          .map((c) => c.chapter?.title)
          .filter((t): t is string => Boolean(t)), // 无章节卡（非公版书）不计章节
      ),
    ],
  }
}

/**
 * 全书卡组（书本详情页）：本书全部 APPROVED 卡 + 已学标记。
 * 每张卡带技能分类内的序号 no（模块内从 01 起，按章节顺序），模块按首次出现顺序返回。
 */
export async function bookDeck(userId: string, bookId: string) {
  const [states, cards] = await Promise.all([
    prisma.cardState.findMany({
      where: { userId, card: { bookId } },
      select: { cardId: true },
    }),
    prisma.card.findMany({
      where: { bookId, status: 'APPROVED' },
      orderBy: { sortOrder: 'asc' }, // 数据源 JSON 顺序（入库序），与章节无关
    }),
  ])
  const learned = new Set(states.map((s) => s.cardId))

  const counters = new Map<string, number>()
  const modules: string[] = []
  const cardsOut = cards.map((c) => {
    if (!counters.has(c.module)) {
      counters.set(c.module, 0)
      modules.push(c.module)
    }
    const no = (counters.get(c.module) ?? 0) + 1
    counters.set(c.module, no)
    return {
      id: c.id,
      module: c.module,
      no: String(no).padStart(2, '0'),
      title: c.title,
      subtitle: c.definition,
      quote: c.quote,
      source: c.source ?? '',
      recast: c.recast,
      trigger: c.trigger,
      boundaries: c.boundaries.join('\n'),
      learned: learned.has(c.id),
    }
  })
  return { cards: cardsOut, modules, learnedCount: learned.size }
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
