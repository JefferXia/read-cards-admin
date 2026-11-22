import { prisma } from './db'
import { getOrSet, onInvalidateBooks } from './cache'
import type { Prisma } from '@prisma/client'

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

export function newCardsCap(member = false): number {
  const cap = Number(process.env.DAILY_NEW_CARDS ?? 6)
  return member ? cap * 2 : cap
}

/** 是否会员（虚拟支付「会员月卡」未到期即会员；权益：今日目标 ×2） */
export function isMember(membershipExpiresAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(membershipExpiresAt && membershipExpiresAt > now)
}

/** 单次复习队列上限（复习只做一遍，队列逐张过完即止） */
export function reviewDueCap(): number {
  return Number(process.env.REVIEW_DUE_CAP ?? 3)
}

/** 入册后的首次复习到期时间：次日（约 20 小时后） */
export function initialDue(now = new Date()): Date {
  return new Date(now.getTime() + 20 * 60 * 60 * 1000)
}

/** 复习间隔阶梯（天）：第 1 步（1 天）= 入册/学完 → 首次复习；复习后的间隔从第 2 步起：3 → 7 → 14 → 30（封顶） */
export const INTERVAL_LADDER = [1, 3, 7, 14, 30]

/**
 * 自适应复习排程：按三档结论重排下次到期时间。
 * - 首次复习前的那段间隔（入册即到期 / 学完次日）已消耗阶梯第 1 步（1 天），
 *   复习后的间隔自第 2 步起算：第 1 次复习后 3 天、第 2 次后 7 天、第 3 次后 14 天、之后 30 天封顶
 * - tier 0 有点遗忘：阶梯归零，回起点（1 天后再见）
 * - 毕业不看间隔，累计两次「很巩固」（tier2Count ≥ 2）即 MASTERED
 */
export function scheduleReview(
  tier: 0 | 1 | 2,
  state: { reps: number; tier2Count: number },
  now = new Date(),
) {
  const tier2Count = tier === 2 ? state.tier2Count + 1 : state.tier2Count
  if (tier2Count >= 2) {
    // 毕业：退出复习队列（dueAt 不再使用，落当前时间）
    return { phase: 'MASTERED' as const, reps: state.reps, tier2Count, intervalDays: null, dueAt: now }
  }
  const reps = tier === 0 ? 0 : state.reps + 1
  // 间隔按「已完成的复习轮数」取阶梯：reps=1 → 3 天，2 → 7 天，3 → 14 天，≥4 → 30 天封顶；tier0 归零 → 1 天
  const intervalDays = INTERVAL_LADDER[Math.min(Math.max(reps, 0), INTERVAL_LADDER.length - 1)]
  return {
    phase: 'DONE' as const,
    reps,
    tier2Count,
    intervalDays,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
  }
}

/** 带 chapters 的书目（缓存单元：书与章节只在导入/切换时变化，极低频） */
export type BookWithChapters = Prisma.BookGetPayload<{ include: { chapters: true } }>

/**
 * 进程内书目缓存（TTL 60s）：书目几乎不变，而每条 SQL 跨区 RTT ~90ms——
 * 活跃书/按 id 取书这类热点查询直接命中内存，省掉重复往返。
 * 多实例部署时各实例独立过期；导入脚本改书后最多延迟 TTL 生效。
 */
const BOOK_CACHE_TTL = 60_000
const bookCache = new Map<string, { at: number; book: BookWithChapters }>()
// admin 切换活跃书/改书后与统一失效联动（否则 activeBook 最长 60s 返回旧书）
onInvalidateBooks(() => bookCache.clear())

async function cachedBook(key: string, load: () => Promise<BookWithChapters | null>) {
  const hit = bookCache.get(key)
  if (hit && Date.now() - hit.at < BOOK_CACHE_TTL) return hit.book
  const book = await load()
  if (book) bookCache.set(key, { at: Date.now(), book })
  return book
}

/** 当前全局活跃书（进程内缓存 60s） */
export function activeBook() {
  return cachedBook('active', () =>
    prisma.book.findFirst({ where: { status: 'ACTIVE' }, include: { chapters: true } }),
  )
}

/** 按 id 取书（进程内缓存 60s）：换书校验等热点路径用 */
export function getBookWithChapters(bookId: string) {
  return cachedBook(bookId, () =>
    prisma.book.findUnique({ where: { id: bookId }, include: { chapters: true } }),
  )
}

/** 本书全部 APPROVED 卡的全量视图（缓存单元：卡内容对所有用户一致，仅已学标记因人而异） */
export type BookCards = Prisma.CardGetPayload<{ include: { chapter: { select: { title: true } } } }>[]

/**
 * 本书全部 APPROVED 卡（进程内缓存 5 分钟，key book:cards:<bookId>）：
 * bookDeck / todayPlan 共用。卡内容重（quote/recast/trigger/边界），用户个人
 * 只差一组 cardId 集合，故全局卡列表按书缓存，个人 state 每次现查再合并。
 * admin 卡写操作后由 invalidateBookCaches() 整体失效（含本键）。
 */
export function bookCards(bookId: string) {
  return getOrSet(`book:cards:${bookId}`, 5 * 60_000, async (): Promise<BookCards> =>
    prisma.card.findMany({
      where: { bookId, status: 'APPROVED' },
      orderBy: { sortOrder: 'asc' }, // 数据源 JSON 顺序（入库序），与章节无关
      include: { chapter: { select: { title: true } } },
    }),
  )
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
  // 一次 join 取回「最近领取 + 其书目」，省一条串行 RTT
  // （bookId 非空的行 book 必非空：relation onDelete: SetNull 保证删除书时 bookId 同步置空）
  const last = await prisma.dailyClaim.findFirst({
    where: { userId, bookId: { not: null } },
    orderBy: [{ claimDate: 'desc' }, { createdAt: 'desc' }],
    include: { book: { include: { chapters: true } } },
  })
  if (last?.book) {
    if (last.claimDate === dateKey() || (await bookHasRemaining(userId, last.book.id))) {
      return last.book
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
    const book = await getBookWithChapters(wantedBookId) // 目录缓存命中则书目 0 RTT
    if (book && (await bookHasRemaining(userId, book.id))) return book
  }
  return resolveBook(userId)
}

/**
 * 今日阅读计划：每天固定 newCardsCap() 张（DAILY_NEW_CARDS）。
 * 未学卡按章节顺序顺位取；今天已学的卡保留在计划里（前端展示勾），
 * 学一张少一张待学、不后移，计划当天稳定。书余量不足时有多少取多少。
 */
export async function todayPlan(userId: string, bookId: string, member = false) {
  const cap = newCardsCap(member)
  const dayStartAt = dayStart()
  const [states, cards] = await Promise.all([
    prisma.cardState.findMany({
      where: { userId, card: { bookId } },
      select: { cardId: true, createdAt: true },
    }),
    bookCards(bookId), // 全局卡列表命中缓存（个人 state 现查）
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
    bookCards(bookId), // 全局卡列表命中缓存（个人 state 现查）
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
      audioUrl: c.audioUrl,
      learned: learned.has(c.id),
    }
  })
  return { cards: cardsOut, modules, learnedCount: learned.size }
}

/**
 * 每日领取（打卡）统计已下线：claimedToday 用单条 count 现查（/api/me），
 * 连续天数由小程序端本地计算（进入小程序即算）。
 */
