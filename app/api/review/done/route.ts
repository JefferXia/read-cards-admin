import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { judgeAnswer } from '@/lib/judge'

export const runtime = 'nodejs'

const TIER_SCORE = [3, 6, 9] // 档位兜底分（无复述文本时）

/**
 * POST /api/review/done { cardId, answer?, tier? } —— 完成一张卡的复习（只做一遍）
 * - 有 answer：AI 按 10 分制判分 → 三档结论（页面只透出 tier）
 * - 无 answer（前端已定档）：直接落 tier
 * 完成后 phase=DONE，退出复习队列。
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
    where: { userId, cardId },
    include: { card: true },
  })
  if (!state) return NextResponse.json({ error: 'state_not_found' }, { status: 404 })

  // 幂等：已复习过直接返回原结果
  if (state.phase === 'DONE') {
    return NextResponse.json({
      ok: true,
      already: true,
      score: state.score,
      tier: state.tier,
      feedback: '',
    })
  }

  let score: number
  let tier: 0 | 1 | 2
  let feedback = ''
  if (answer) {
    const judged = await judgeAnswer(
      {
        id: state.card.id,
        title: state.card.title,
        definition: state.card.definition,
        recast: state.card.recast,
        trigger: state.card.trigger,
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

  await prisma.cardState.update({
    where: { id: state.id },
    data: { score, tier, reviewedAt: new Date(), phase: 'DONE' },
  })

  return NextResponse.json({ ok: true, score, tier, feedback })
}
