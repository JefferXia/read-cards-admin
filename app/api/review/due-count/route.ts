import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/review/due-count —— 到期复习数（首页顶部通知专用轻量接口）
 * 单条 count：到期含首次到期（NEW）与复习过再次到期（DONE）；MASTERED 毕业不计。
 * （此前首页拉全量 /api/me 只为这个数，代价太大）
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const dueCount = await prisma.cardState.count({
    where: { userId, phase: { in: ['NEW', 'DONE'] }, dueAt: { lte: new Date() } },
  })
  return NextResponse.json({ dueCount })
}
