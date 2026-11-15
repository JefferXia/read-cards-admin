import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { reviewDueCap } from '@/lib/study'

export const runtime = 'nodejs'

/**
 * GET /api/review/due —— 到期复习队列（自适应排程）
 * - 入册未复习（NEW）+ 复习过但到期（DONE）都入队；MASTERED 不再出现
 * - 多本书交错出题：按 dueAt 取一批候选，再按书轮转（round-robin）取满 cap，
 *   避免队列被同一本书占满
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 候选池放宽到 cap×10（足够跨书交错），仍按到期先后排序
  const pool = await prisma.cardState.findMany({
    where: {
      userId,
      phase: { in: ['NEW', 'DONE'] },
      dueAt: { lte: new Date() },
      card: { status: 'APPROVED' },
    },
    orderBy: { dueAt: 'asc' },
    take: reviewDueCap() * 10,
    include: { card: true },
  })

  // 按书分组（保持到期先后），逐轮每书取一张直到 cap（跨书交错）
  const byBook = new Map<string, typeof pool>()
  for (const d of pool) {
    const list = byBook.get(d.card.bookId) ?? []
    list.push(d)
    byBook.set(d.card.bookId, list)
  }
  const groups = [...byBook.values()]
  const picked: typeof pool = []
  while (picked.length < reviewDueCap() && groups.length > 0) {
    for (const g of groups) {
      if (picked.length >= reviewDueCap()) break
      picked.push(g.shift()!)
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].length === 0) groups.splice(i, 1)
    }
  }

  return NextResponse.json(
    picked.map((d) => ({
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
