import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { reviewDueCap } from '@/lib/study'

export const runtime = 'nodejs'

/**
 * GET /api/review/due —— 到期复习队列（自适应排程）
 * - 入册未复习（NEW）+ 复习过但到期（DONE）都入队；MASTERED 不再出现
 * - 全局卡（card）+ 自建认知卡（userCard）统一出题
 * - 多本书交错出题：按到期先后取一批候选，再按书/卡包轮转（round-robin）取满 cap，
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
      OR: [{ card: { status: 'APPROVED' } }, { userCardId: { not: null } }],
    },
    orderBy: { dueAt: 'asc' },
    take: reviewDueCap() * 10,
    include: { card: true, userCard: true },
  })

  // 按书分组（自建卡按卡包标题分组），逐轮每组取一张直到 cap（跨书/卡包交错）
  const byBook = new Map<string, typeof pool>()
  for (const d of pool) {
    const key = d.card ? d.card.bookId : d.userCard?.sourceTitle || '认知卡'
    const list = byBook.get(key) ?? []
    list.push(d)
    byBook.set(key, list)
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
    picked.map((d) => {
      // 自建认知卡：module + 卡名 + 重构阐释 + 原文整段（无 trigger/边界）
      if (d.userCardId && d.userCard) {
        return {
          id: d.userCard.id,
          module: d.userCard.module,
          title: d.userCard.title,
          subtitle: '',
          quote: d.userCard.quote,
          source: d.userCard.sourceTitle,
          recast: d.userCard.recast,
          trigger: '',
          boundaries: '',
          learned: true,
        }
      }
      return {
        id: d.card!.id,
        module: d.card!.module,
        title: d.card!.title,
        subtitle: d.card!.definition,
        quote: d.card!.quote,
        source: d.card!.source ?? '',
        recast: d.card!.recast,
        trigger: d.card!.trigger,
        boundaries: d.card!.boundaries.join('\n'),
        learned: true,
      }
    }),
  )
}
