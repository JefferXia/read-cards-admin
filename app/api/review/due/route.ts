import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { reviewDueCap } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/review/due —— 到期复习队列（入册次日到期，逐张复习一遍） */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const due = await prisma.cardState.findMany({
    where: { userId, phase: 'NEW', dueAt: { lte: new Date() }, card: { status: 'APPROVED' } },
    orderBy: { dueAt: 'asc' },
    take: reviewDueCap(),
    include: { card: true },
  })

  return NextResponse.json(
    due.map((d) => ({
      id: d.card.id,
      module: d.card.module,
      title: d.card.title,
      subtitle: d.card.definition,
      quote: d.card.quote,
      source: d.card.source ?? '',
      recast: d.card.recast,
      trigger: d.card.trigger,
      boundaries: d.card.boundaries.join('\n'),
      learned: true,
    })),
  )
}
