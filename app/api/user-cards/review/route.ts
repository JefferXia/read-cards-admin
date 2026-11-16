import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/user-cards/review { id } —— 自建认知卡加入复习周期
 *
 * 入册即到期（dueAt = now），马上出现在复习队列；与全局卡「加入记忆」同款节奏。
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
      dueAt: new Date(), // 入册即到期：马上进入复习队列
      phase: 'NEW',
    },
  })
  return NextResponse.json({ ok: true })
}
