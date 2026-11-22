import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/admin'
import { getOrSet } from '@/lib/cache'

export const runtime = 'nodejs'

/** GET /api/admin/stats —— 简单数据看板（30s 短缓存，保实时性） */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const data = await getOrSet('admin:stats', 30_000, async () => {
      const [users, cards, approved, draft, reviewedCount, avgScore, recentReviews] = await Promise.all([
        prisma.user.count(),
        prisma.card.count(),
        prisma.card.count({ where: { status: 'APPROVED' } }),
        prisma.card.count({ where: { status: 'DRAFT' } }),
        prisma.cardState.count({ where: { reviewedAt: { not: null } } }),
        prisma.cardState.aggregate({ where: { score: { not: null } }, _avg: { score: true } }),
        prisma.cardState.findMany({
          where: { reviewedAt: { not: null }, cardId: { not: null } },
          orderBy: { reviewedAt: 'desc' },
          take: 10,
          include: { card: { select: { title: true } } },
        }),
      ])

      return {
        users,
        cards: { total: cards, approved, draft },
        reviewedCount,
        averageScore: Math.round(avgScore._avg.score ?? 0),
        recentReviews: recentReviews.map((r) => ({
          id: r.id,
          title: r.card?.title ?? '（卡已删除）',
          score: r.score,
          tier: r.tier,
          reviewedAt: r.reviewedAt,
        })),
      }
    })

    return NextResponse.json(data)
  } catch (e) {
    console.error('[api/admin/stats]', e)
    // dev 环境附带错误详情便于排查（管理台接口，不外泄生产）
    return NextResponse.json(
      { error: 'stats_failed', detail: process.env.NODE_ENV === 'production' ? undefined : String(e) },
      { status: 500 },
    )
  }
}
