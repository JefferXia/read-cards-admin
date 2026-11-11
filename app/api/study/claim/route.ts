import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { claimStats, dateKey, resolveBook } from '@/lib/study'

export const runtime = 'nodejs'

/**
 * POST /api/study/claim { confusion? } —— 领取今日（打卡）
 * 一天一条：重复领取只保留第一次；困惑选填（当天补填一次）。
 * 同时锁定今日书目（bookId）：前一本未读完则续读，读完才切全局活跃书。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { confusion?: string }
  const confusion = (body.confusion ?? '').trim().slice(0, 120)

  const claimDate = dateKey()
  const book = await resolveBook(userId)
  await prisma.dailyClaim.upsert({
    where: { userId_claimDate: { userId, claimDate } },
    update: {},
    create: { userId, claimDate, confusion: confusion || null, bookId: book?.id ?? null },
  })

  const claim = await claimStats(userId)
  return NextResponse.json({ ok: true, claimedToday: true, streakDays: claim.streakDays })
}
