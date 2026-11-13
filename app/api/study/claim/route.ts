import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { claimBook, claimStats, dateKey } from '@/lib/study'

export const runtime = 'nodejs'

/**
 * POST /api/study/claim { confusion?, bookId? } —— 领取今日（打卡）
 * 一天一条：打卡与困惑只保留第一次；困惑选填（当天补填一次）。
 * 锁定今日书目：请求带 bookId（刷新书单选中的书，还有未学卡）则切到它
 * ——换书以「领取」为确认动作；否则走默认书单（claim 链：前一本未读完则续读，
 * 读完才切全局活跃书）。领取的书写入书单表（UserBook，去重）：只领取过的书才进书单。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { confusion?: string; bookId?: string }
  const confusion = (body.confusion ?? '').trim().slice(0, 120)
  const wantedBookId = typeof body.bookId === 'string' && body.bookId ? body.bookId : undefined

  const claimDate = dateKey()
  const book = await claimBook(userId, wantedBookId)
  // 两条写入互不依赖，并行落库（省 1 次串行 RTT）
  const ops: Promise<unknown>[] = [
    prisma.dailyClaim.upsert({
      where: { userId_claimDate: { userId, claimDate } },
      update: { bookId: book?.id ?? null },
      create: { userId, claimDate, confusion: confusion || null, bookId: book?.id ?? null },
    }),
  ]
  if (book) {
    // 领取过的书才进书单（去重，重复领取只刷新时间）
    ops.push(
      prisma.userBook.upsert({
        where: { userId_bookId: { userId, bookId: book.id } },
        update: {},
        create: { userId, bookId: book.id },
      }),
    )
  }
  await Promise.all(ops)

  const claim = await claimStats(userId)
  return NextResponse.json({ ok: true, claimedToday: true, streakDays: claim.streakDays })
}
