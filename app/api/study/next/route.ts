import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { dayStart, resolveBook, todayPlan } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/study/next —— 今日阅读计划（每天固定 DAILY_NEW_CARDS 张），含已学标记 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const book = await resolveBook(userId)
  if (!book) return NextResponse.json({ cards: [], target: 0, learnedToday: 0 })

  const [plan, learnedToday, dueCount] = await Promise.all([
    todayPlan(userId, book.id),
    prisma.cardState.count({ where: { userId, createdAt: { gte: dayStart() } } }),
    // 到期复习数：卡列表页不再请求 /me，由本接口带回
    prisma.cardState.count({ where: { userId, phase: 'NEW', dueAt: { lte: new Date() } } }),
  ])

  return NextResponse.json({
    dueCount,
    target: plan.target,
    learnedToday,
    remaining: Math.max(0, plan.target - plan.cards.filter((c) => c.learned).length),
    chapters: plan.pickedChapters,
    cards: plan.cards,
  })
}
