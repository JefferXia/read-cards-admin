import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/cards/review { cardId } —— 全局书卡加入记忆（入册复习周期）
 * 入册即到期（dueAt = now），马上出现在复习队列；与 /api/user-cards/review（自建卡）同款节奏。
 * 幂等：已入册返回 { ok: true, already: true }；卡不存在统一 404。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { cardId?: string }
  const cardId = (body.cardId ?? '').trim()
  if (!cardId) return NextResponse.json({ error: 'cardId_required' }, { status: 400 })

  const card = await prisma.card.findFirst({
    where: { id: cardId, status: 'APPROVED' },
    select: { id: true },
  })
  if (!card) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const existing = await prisma.cardState.findFirst({
    where: { userId, cardId },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ ok: true, already: true })

  await prisma.cardState.create({
    data: {
      userId,
      cardId,
      dueAt: new Date(), // 入册即到期：马上进入复习队列（读书学卡流程 study/complete 仍次日到期）
      phase: 'NEW',
    },
  })
  return NextResponse.json({ ok: true })
}
