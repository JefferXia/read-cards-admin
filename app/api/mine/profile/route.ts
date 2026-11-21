import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/mine/profile —— 个人主页统计（我的页专用轻量接口）
 * 昵称 + 进入记忆（全部学习轨迹数）+ 成功记忆（毕业卡数）+ 剩余积分。
 * （此前「我的」页拉全量 /api/me 只为这三个数，不带任何书/计划逻辑）
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [meRow, learnedAll, masteredCount, creditRow] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } }),
    // 进入记忆：跨书全量学习轨迹（换书不丢历史）
    prisma.cardState.count({ where: { userId } }),
    // 成功记忆：毕业卡数（两次「很巩固」，已退出复习队列）
    prisma.cardState.count({ where: { userId, phase: 'MASTERED' } }),
    // 剩余积分（每次 AI 生成扣 10；会员月卡发货自动充值 1000）
    prisma.subscribeCredit.findUnique({ where: { userId }, select: { credits: true } }),
  ])

  return NextResponse.json({
    nickname: meRow?.nickname ?? null,
    learnedCards: learnedAll,
    masteredCards: masteredCount,
    credits: creditRow?.credits ?? 0,
  })
}
