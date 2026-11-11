import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

/** GET /api/admin/stats —— 简单数据看板 */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [users, cards, approved, draft, reviewedCount, avgScore, recentReviews] = await Promise.all([
    prisma.user.count(),
    prisma.card.count(),
    prisma.card.count({ where: { status: 'APPROVED' } }),
    prisma.card.count({ where: { status: 'DRAFT' } }),
    prisma.cardState.count({ where: { reviewedAt: { not: null } } }),
    prisma.cardState.aggregate({ where: { score: { not: null } }, _avg: { score: true } }),
    prisma.cardState.findMany({
      where: { reviewedAt: { not: null } },
      orderBy: { reviewedAt: 'desc' },
      take: 10,
      include: { card: { select: { title: true } } },
    }),
  ])

  return NextResponse.json({
    users,
    cards: { total: cards, approved, draft },
    reviewedCount,
    averageScore: Math.round(avgScore._avg.score ?? 0),
    recentReviews: recentReviews.map((r) => ({
      id: r.id,
      title: r.card.title,
      score: r.score,
      tier: r.tier,
      reviewedAt: r.reviewedAt,
    })),
  })
}
