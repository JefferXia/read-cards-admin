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
 * GET /api/mine/learned —— 个人主页：在温习的卡（学过但未毕业）
 * 以书名聚合（首次学卡时间正序），书内按学习时间正序；
 * 毕业卡（MASTERED，两次「很巩固」）不在本接口返回 —— 它们计入 /api/me 的成功记忆。
 * tier 0/1/2 = 三种温习结论，null = 未温习（前端浅灰卡）。
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const states = await prisma.cardState.findMany({
    // 学过的知识卡 = 全局卡的学习轨迹（自建认知卡走「我的卡片」卡包，不进本页）；
    // 只出在温习的卡：毕业（MASTERED）已退出复习队列，不再列出
    where: { userId, cardId: { not: null }, phase: { not: 'MASTERED' } },
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
    const b = s.card!.book
    let g = groups.get(b.id)
    if (!g) {
      g = { bookId: b.id, title: b.title, cards: [] }
      groups.set(b.id, g)
    }
    g.cards.push({
      id: s.cardId!,
      module: s.card!.module,
      title: s.card!.title,
      // Card 模型无 subtitle 字段，与 /api/review/due 一致：副标题 = definition
      subtitle: s.card!.definition,
      quote: s.card!.quote,
      source: s.card!.source ?? '',
      definition: s.card!.definition,
      recast: s.card!.recast,
      trigger: s.card!.trigger,
      boundaries: s.card!.boundaries.join('\n'),
      learned: true,
      learnedAt: s.createdAt.toISOString(),
      tier: s.tier,
    })
  }

  return NextResponse.json({ books: [...groups.values()] })
}
