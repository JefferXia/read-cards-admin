import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { claimStats, dayStart, resolveBook, todayPlan } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/me —— 首页状态：到期复习、今日新学余量、领取打卡、章节进度、订阅余额 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  const book = await resolveBook(userId)
  const plan = book ? await todayPlan(userId, book.id) : { target: 0, pickedChapters: [], cards: [] }

  const [dueCount, learnedToday, credits, claim, meRow] = await Promise.all([
    prisma.cardState.count({ where: { userId, phase: 'NEW', dueAt: { lte: now } } }),
    prisma.cardState.count({ where: { userId, createdAt: { gte: dayStart(now) } } }),
    prisma.subscribeCredit.findUnique({ where: { userId } }),
    claimStats(userId),
    // 昵称（「我的」页展示 + 微信昵称快捷填入）
    prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } }),
  ])

  let progress = { unlockedIdx: 0, totalChapters: 0, learnedCards: 0, totalCards: 0 }
  if (book) {
    const [chapters, states, totalCards] = await Promise.all([
      prisma.chapter.findMany({
        where: { bookId: book.id },
        orderBy: { idx: 'asc' },
        include: { cards: { where: { status: 'APPROVED' }, select: { id: true } } },
      }),
      prisma.cardState.findMany({
        where: { userId, card: { bookId: book.id } },
        select: { cardId: true },
      }),
      // 总卡数直接按书数（无章节卡的非公版书没有章可汇总）
      prisma.card.count({ where: { bookId: book.id, status: 'APPROVED' } }),
    ])
    const learned = new Set(states.map((s) => s.cardId))
    // 阅读位置 = 第一张未学卡所在章（全部读完则为最后一章；无章节书为 0）
    const current = chapters.find((ch) => ch.cards.some((c) => !learned.has(c.id)))
    progress = {
      unlockedIdx: (current ?? chapters[chapters.length - 1])?.idx ?? 0,
      totalChapters: chapters.length,
      learnedCards: learned.size,
      totalCards,
    }
  }

  return NextResponse.json({
    nickname: meRow?.nickname ?? null,
    dueCount,
    study: {
      cap: plan.target, // 今日目标 = 固定 DAILY_NEW_CARDS 张（书尾不足则取余量）
      learnedToday,
      remaining: Math.max(0, plan.target - learnedToday),
    },
    progress,
    subscribeCredits: credits?.credits ?? 0,
    streakDays: claim.streakDays,
    claimedToday: claim.claimedToday,
    book: book
      ? {
          id: book.id,
          title: book.title,
          subtitle: book.subtitle,
          author: book.author,
          tagline: book.tagline,
        }
      : null,
  })
}
