import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { dateKey, resolveBook, todayPlan } from '@/lib/study'

export const runtime = 'nodejs'

/**
 * GET /api/me —— 领取页（claim）专用：今日书 + 今日目标 + 是否已领 + 到期数
 * 消费方：领取页（book / study.cap / progress.totalCards / dueCount / claimedToday）。
 * 昵称、进入/成功记忆走 /api/mine/profile；到期通知（首页）走 /api/review/due-count；
 * 今日学/学/余量走 /api/study/next —— 本接口不再返回冗余字段。
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  const [book, dueCount, claimedToday] = await Promise.all([
    resolveBook(userId),
    // 到期数含首次到期（NEW）与复习过再次到期（DONE）；MASTERED 不计
    prisma.cardState.count({
      where: { userId, phase: { in: ['NEW', 'DONE'] }, dueAt: { lte: now } },
    }),
    // 今天是否已领取（单条 count；连续天数已改端上本地计算，不再拉 400 行记录）
    prisma.dailyClaim.count({ where: { userId, claimDate: dateKey(now) } }),
  ])

  // study.cap = 今日目标（固定额度，书尾取余量）；progress.totalCards = 本书 APPROVED 卡总数
  let cap = 0
  let totalCards = 0
  if (book) {
    const [plan, tc] = await Promise.all([
      todayPlan(userId, book.id),
      // 本书总卡数（无章节卡的非公版书没有章可汇总，直接按书数）
      prisma.card.count({ where: { bookId: book.id, status: 'APPROVED' } }),
    ])
    cap = plan.target
    totalCards = tc
  }

  return NextResponse.json({
    dueCount,
    study: { cap },
    progress: { totalCards },
    claimedToday,
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
