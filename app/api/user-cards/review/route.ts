import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { initialDue } from '@/lib/study'

export const runtime = 'nodejs'

/**
 * POST /api/user-cards/review { id } —— 自建认知卡加入复习周期
 *
 * 首次到期按全局卡同款节奏：次日（initialDue，约 20 小时后）。
 * 幂等：已入册返回 { ok: true, already: true }；卡不存在/别人的统一 404。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { id?: string }
  const id = (body.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const card = await prisma.userCard.findFirst({ where: { id, userId }, select: { id: true } })
  if (!card) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const existing = await prisma.cardState.findFirst({
    where: { userId, userCardId: id },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ ok: true, already: true })

  await prisma.cardState.create({
    data: {
      userId,
      userCardId: id,
      dueAt: initialDue(), // 首次复习明日到期，与全局卡入册节奏一致
      phase: 'NEW',
    },
  })
  return NextResponse.json({ ok: true })
}
