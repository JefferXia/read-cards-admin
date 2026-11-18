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
  /** 下次记忆时间（ISO，当前排程的到期时间；毕业卡 = 毕业时刻） */
  nextAt: string
  /** 是否已毕业（MASTERED，两次「很巩固」，退出复习队列） */
  graduated: boolean
  /** 记忆进度 0–100（打分 + 复习轮数 + 巩固次数综合） */
  progress: number
  /** 朗读音频（null = 未生成，点播放时服务端按需合成 recast 并缓存） */
  audioUrl: string | null
  /** 卡来源：card = 书卡，user = 自建卡（点播放传给 /api/tts 免级联查询） */
  kind: 'card' | 'user'
}

/** 记忆进度 0–100：最近打分 40% + 复习轮数 40%（阶梯 5 级封顶）+ 巩固次数 20%（毕业 2 次封顶） */
function memoryProgress(s: { score: number | null; reps: number; tier2Count: number }): number {
  const byScore = ((s.score ?? 0) / 10) * 40
  const byReps = (Math.min(s.reps, 5) / 5) * 40
  const byTier2 = (Math.min(s.tier2Count, 2) / 2) * 20
  return Math.round(byScore + byReps + byTier2)
}

/**
 * GET /api/mine/learned —— 个人主页：在学的卡（全部记忆轨迹，含毕业卡）
 * 全局卡 + 自建认知卡都在内（CardState 用户数据；自建卡按 sourceTitle 聚合，bookId 为空串），
 * 以书名/卡包名聚合（最近学卡的书在前），书内按学习时间倒序（新→旧）；
 * 毕业卡（MASTERED，两次「很巩固」）也返回，带 graduated 标记（dueAt = 毕业时刻），
 * 前端据此把卡脚显示为「已毕业」。毕业卡同时计入 /api/me 的成功记忆。
 * progress = 记忆进度 0–100（打分/复习轮数/巩固次数综合），前端进度条展示。
 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const states = await prisma.cardState.findMany({
    // 全部学习轨迹（全局卡 cardId + 自建认知卡 userCardId），毕业卡不排除、用 graduated 标记区分
    where: { userId },
    // 学习时间倒序（新→旧）：最近在学的卡/书排前面
    orderBy: { createdAt: 'desc' },
    select: {
      cardId: true,
      userCardId: true,
      score: true,
      reps: true,
      tier2Count: true,
      createdAt: true,
      dueAt: true,
      phase: true,
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
          audioUrl: true,
          book: { select: { id: true, title: true } },
        },
      },
      userCard: { select: { sourceTitle: true, sourceAuthor: true, module: true, title: true, quote: true, recast: true, audioUrl: true } },
    },
  })

  const groups = new Map<string, { bookId: string; title: string; cards: LearnedCardOut[] }>()
  for (const s of states) {
    if (s.card) {
      // 全局卡（书卡）
      const b = s.card.book
      let g = groups.get(b.id)
      if (!g) {
        g = { bookId: b.id, title: b.title, cards: [] }
        groups.set(b.id, g)
      }
      g.cards.push({
        id: s.cardId!,
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
        nextAt: s.dueAt.toISOString(),
        graduated: s.phase === 'MASTERED',
        // 毕业即完全掌握：直接 100%（memoryProgress 的三档权重是给在学卡设计的，
        // 毕业路径 reps 最多 2~3 轮，永远算不满）
        progress: s.phase === 'MASTERED' ? 100 : memoryProgress(s),
        audioUrl: s.card.audioUrl,
        kind: 'card',
      })
    } else if (s.userCard) {
      // 自建认知卡（按卡包标题聚合，bookId 空串）
      const uc = s.userCard
      const key = `uc:${uc.sourceTitle}`
      let g = groups.get(key)
      if (!g) {
        g = { bookId: '', title: uc.sourceTitle || '自建卡', cards: [] }
        groups.set(key, g)
      }
      g.cards.push({
        id: s.userCardId!,
        module: uc.module,
        title: uc.title,
        // UserCard 无 definition：副标题/定义都用 recast（与自建卡包展示一致）
        subtitle: uc.recast,
        quote: uc.quote,
        source: uc.sourceAuthor,
        definition: uc.recast,
        recast: uc.recast,
        trigger: '',
        boundaries: '',
        learned: true,
        learnedAt: s.createdAt.toISOString(),
        nextAt: s.dueAt.toISOString(),
        graduated: s.phase === 'MASTERED',
        progress: s.phase === 'MASTERED' ? 100 : memoryProgress(s),
        audioUrl: uc.audioUrl,
        kind: 'user',
      })
    }
  }

  return NextResponse.json({ books: [...groups.values()] })
}
