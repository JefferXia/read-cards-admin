import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { judgeAnswer } from '@/lib/judge'
import { scheduleReview } from '@/lib/study'
import { invalidateUserCaches } from '@/lib/cache'

export const runtime = 'nodejs'

const TIER_SCORE = [3, 6, 9] // 档位兜底分（无复述文本时）

/**
 * POST /api/review/done { cardId, answer?, tier? } —— 完成一张卡的复习（自适应排程）
 * - 有 answer：AI 按 10 分制判分 → 三档结论（页面只透出 tier）
 * - 无 answer（前端已定档）：直接落 tier
 * 按 tier 重排下次到期（1→3→7→14→30 天阶梯，遗忘归零）；
 * 累计两次「很巩固」毕业（phase=MASTERED，退出队列）。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    cardId?: string
    answer?: string
    tier?: number
  }
  const cardId = body.cardId
  if (!cardId) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const answer = (body.answer ?? '').trim().slice(0, 500)

  const state = await prisma.cardState.findFirst({
    where: { userId, OR: [{ cardId: cardId }, { userCardId: cardId }] },
    include: { card: true, userCard: true },
  })
  if (!state) return NextResponse.json({ error: 'state_not_found' }, { status: 404 })

  // 幂等：已毕业直接返回
  if (state.phase === 'MASTERED') {
    return NextResponse.json({ ok: true, already: true, score: state.score, tier: state.tier, feedback: '', graduated: true })
  }
  // 防连点：未到期的卡（刚复习过、dueAt 在未来）不重复计复习
  if (state.phase === 'DONE' && state.dueAt > new Date()) {
    return NextResponse.json({
      ok: true,
      already: true,
      score: state.score,
      tier: state.tier,
      feedback: '',
      graduated: false,
    })
  }

  let score: number
  let tier: 0 | 1 | 2
  let feedback = ''
  if (answer) {
    // 自建认知卡：无 trigger/边界，判分对照卡名 + 重构阐释（definition/trigger 传空）
    const c = state.card ?? state.userCard
    if (!c) return NextResponse.json({ error: 'state_not_found' }, { status: 404 })
    const judged = await judgeAnswer(
      {
        id: c.id,
        title: c.title,
        definition: state.card ? state.card.definition : '',
        recast: c.recast,
        trigger: state.card ? state.card.trigger : '',
      },
      answer,
    )
    score = judged.score
    tier = judged.tier
    feedback = judged.feedback
  } else {
    tier = Math.max(0, Math.min(2, Math.round(body.tier ?? 1))) as 0 | 1 | 2
    score = TIER_SCORE[tier]
  }

  const next = scheduleReview(tier, { reps: state.reps, tier2Count: state.tier2Count })
  await prisma.cardState.update({
    where: { id: state.id },
    data: {
      score,
      tier,
      reviewedAt: new Date(),
      phase: next.phase,
      reps: next.reps,
      tier2Count: next.tier2Count,
      dueAt: next.dueAt,
    },
  })
  invalidateUserCaches(userId) // 念簿展示 tier/score/reviewedAt

  return NextResponse.json({
    ok: true,
    score,
    tier,
    feedback,
    graduated: next.phase === 'MASTERED',
    nextDays: next.intervalDays,
  })
}
