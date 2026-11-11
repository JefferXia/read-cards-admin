import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { dayStart, initialDue, newCardsCap } from '@/lib/study'

export const runtime = 'nodejs'

/** POST { cardIds } —— 确认学完这批新卡 → 入册（次日进入复习队列） */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { cardIds?: string[] }
  const cardIds = [...new Set(body.cardIds ?? [])]
  if (!cardIds.length) return NextResponse.json({ error: 'empty cardIds' }, { status: 400 })

  const learnedToday = await prisma.cardState.count({
    where: { userId, createdAt: { gte: dayStart() } },
  })
  const remaining = Math.max(0, newCardsCap() - learnedToday)
  if (cardIds.length > remaining) {
    return NextResponse.json({ error: 'exceed_daily_cap', remaining }, { status: 400 })
  }

  // 仅允许 APPROVED 卡，且必须是用户尚未入册的
  const valid = await prisma.card.findMany({
    where: { id: { in: cardIds }, status: 'APPROVED' },
    select: { id: true },
  })
  const owned = await prisma.cardState.findMany({
    where: { userId, cardId: { in: cardIds } },
    select: { cardId: true },
  })
  const toCreate = valid.map((v) => v.id).filter((id) => !owned.some((o) => o.cardId === id))

  await prisma.cardState.createMany({
    data: toCreate.map((cardId) => ({
      userId,
      cardId,
      dueAt: initialDue(),
      phase: 'NEW' as const,
    })),
    skipDuplicates: true,
  })

  return NextResponse.json({ ok: true, created: toCreate.length })
}
