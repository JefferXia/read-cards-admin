import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'

export const runtime = 'nodejs'

interface LearnedCardOut {
  id: string
  module: string
  title: string
  subtitle: string
  quote: string
  source: string
  definition: string
  recast: string
  trigger: string
  /** 换行分隔的边界列 */
  boundaries: string
  learned: boolean
  /** 学卡时间（ISO，即卡片入册时间） */
  learnedAt: string
  /** 温习结论 0/1/2；null = 未温习 */
  tier: number | null
}

/**
 * GET /api/mine/learned —— 个人主页：学过的知识卡
 * 以书名聚合（首次学卡时间正序），书内按学习时间正序；
 * tier 0/1/2 = 三种温习结论，null = 未温习（前端浅灰卡）。
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const states = await prisma.cardState.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      cardId: true,
      createdAt: true,
      tier: true,
      card: {
        select: {
          module: true,
          title: true,
          quote: true,
          source: true,
          definition: true,
          recast: true,
          trigger: true,
          boundaries: true,
          book: { select: { id: true, title: true } },
        },
      },
    },
  })

  const groups = new Map<string, { bookId: string; title: string; cards: LearnedCardOut[] }>()
  for (const s of states) {
    const b = s.card.book
    let g = groups.get(b.id)
    if (!g) {
      g = { bookId: b.id, title: b.title, cards: [] }
      groups.set(b.id, g)
    }
    g.cards.push({
      id: s.cardId,
      module: s.card.module,
      title: s.card.title,
      // Card 模型无 subtitle 字段，与 /api/review/due 一致：副标题 = definition
      subtitle: s.card.definition,
      quote: s.card.quote,
      source: s.card.source ?? '',
      definition: s.card.definition,
      recast: s.card.recast,
      trigger: s.card.trigger,
      boundaries: s.card.boundaries.join('\n'),
      learned: true,
      learnedAt: s.createdAt.toISOString(),
      tier: s.tier,
    })
  }

  return NextResponse.json({ books: [...groups.values()] })
}
