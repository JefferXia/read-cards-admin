import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { dayStart, resolveBook, todayPlan } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/study/next —— 今日阅读计划（两个章节、不足 6 张向下补齐），含已学标记 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const book = await resolveBook(userId)
  if (!book) return NextResponse.json({ cards: [], target: 0, learnedToday: 0 })

  const plan = await todayPlan(userId, book.id)
  const learnedToday = await prisma.cardState.count({
    where: { userId, createdAt: { gte: dayStart() } },
  })

  return NextResponse.json({
    target: plan.target,
    learnedToday,
    remaining: Math.max(0, plan.target - plan.cards.filter((c) => c.learned).length),
    chapters: plan.pickedChapters,
    cards: plan.cards,
  })
}
