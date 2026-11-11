import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { chapterUnlockMap, claimStats, dayStart, resolveBook, todayPlan } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/me —— 首页状态：到期复习、今日新学余量、领取打卡、章节进度、订阅余额 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  const book = await resolveBook(userId)
  const plan = book ? await todayPlan(userId, book.id) : { target: 0, pickedChapters: [], cards: [] }

  const [dueCount, learnedToday, credits, claim] = await Promise.all([
    prisma.cardState.count({ where: { userId, phase: 'NEW', dueAt: { lte: now } } }),
    prisma.cardState.count({ where: { userId, createdAt: { gte: dayStart(now) } } }),
    prisma.subscribeCredit.findUnique({ where: { userId } }),
    claimStats(userId),
  ])

  let progress = { unlockedIdx: 0, totalChapters: 0, learnedCards: 0, totalCards: 0 }
  if (book) {
    const { learned, unlockedIdxs, chapters } = await chapterUnlockMap(userId, book.id)
    const totalCards = chapters.reduce((s, c) => s + c.cards.length, 0)
    progress = {
      unlockedIdx: Math.max(...unlockedIdxs, -1),
      totalChapters: chapters.length,
      learnedCards: learned.size,
      totalCards,
    }
  }

  return NextResponse.json({
    dueCount,
    study: {
      cap: plan.target, // 今日目标 = 计划内全部卡（两个章节、不足 6 张向下补齐）
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
