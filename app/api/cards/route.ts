import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { resolveBook } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/cards —— 念簿：按章节浏览已学卡片（简单历史列表） */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const book = await resolveBook(userId)
  if (!book) return NextResponse.json({ chapters: [] })

  const chapters = await prisma.chapter.findMany({
    where: { bookId: book.id },
    orderBy: { idx: 'asc' },
    include: {
      cards: {
        where: { status: 'APPROVED' },
        orderBy: { idx: 'asc' },
        include: {
          cardStates: {
            where: { userId },
            select: { reviewedAt: true, tier: true, score: true, phase: true },
          },
        },
      },
    },
  })

  return NextResponse.json({
    chapters: chapters.map((ch) => ({
      idx: ch.idx,
      title: ch.title,
      cards: ch.cards
        .filter((c) => c.cardStates.length > 0) // 只显示已入册的
        .map((c) => ({
          id: c.id,
          title: c.title,
          definition: c.definition,
          quote: c.quote,
          recast: c.recast,
          trigger: c.trigger,
          boundaries: c.boundaries.join('\n'),
          source: c.source ?? '',
          reviewedAt: c.cardStates[0]?.reviewedAt ?? null,
          tier: c.cardStates[0]?.tier ?? null,
          score: c.cardStates[0]?.score ?? null,
        })),
    })),
  })
}
