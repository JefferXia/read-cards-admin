import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { dayStart } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/settlement/today —— 今日战果（学习/复习）+ 明日预告 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  const [learnedToday, reviewed, credits] = await Promise.all([
    prisma.cardState.count({ where: { userId, createdAt: { gte: dayStart(now) } } }),
    prisma.cardState.findMany({
      where: { userId, reviewedAt: { gte: dayStart(now) } },
      include: { card: { select: { id: true, title: true } } },
      orderBy: { reviewedAt: 'desc' },
    }),
    prisma.subscribeCredit.findUnique({ where: { userId } }),
  ])
  const tomorrowDue = await prisma.cardState.count({
    where: { userId, phase: 'NEW', dueAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600 * 1000) } },
  })

  return NextResponse.json({
    learnedToday,
    reviewedToday: reviewed.length,
    results: reviewed.map((r) => ({
      cardId: r.card.id,
      title: r.card.title,
      score: r.score,
      tier: r.tier,
    })),
    tomorrowDue,
    subscribeCredits: credits?.credits ?? 0,
  })
}
