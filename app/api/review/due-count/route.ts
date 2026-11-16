import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { dayStart } from '@/lib/study'

export const runtime = 'nodejs'

/**
 * GET /api/review/due-count —— 到期复习数 + 今日已记忆（轻量统计接口）
 * - dueCount：到期含首次到期（NEW）与复习过再次到期（DONE）；MASTERED 毕业不计。
 *   （此前首页拉全量 /api/me 只为这个数，代价太大）
 * - reviewedToday：今日已记忆张数（reviewedAt 在今日内，全局卡 + 自建卡都算），
 *   待记忆列表页顶部绿色模块用。
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  const [dueCount, reviewedToday] = await Promise.all([
    prisma.cardState.count({
      where: { userId, phase: { in: ['NEW', 'DONE'] }, dueAt: { lte: now } },
    }),
    prisma.cardState.count({ where: { userId, reviewedAt: { gte: dayStart(now) } } }),
  ])
  return NextResponse.json({ dueCount, reviewedToday })
}
