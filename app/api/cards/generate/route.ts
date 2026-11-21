import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateCards } from '@/lib/cardgen'
import { llmProvider } from '@/lib/llm'
import { CARD_COST, deductCredits, ensureCredits, refundCredits } from '@/lib/credits'

export const runtime = 'nodejs'
/** LLM 调用最长 60s：Vercel Hobby 上限 60s，需在函数配置里显式声明 */
export const maxDuration = 60

/**
 * POST /api/cards/generate { title, text, cards? } —— 拍照/粘贴片段 → 认知卡
 *
 * 统一卡型「认知卡」：AI 从片段中提炼 N 张卡（module + 卡名 + 重构阐释 + 逐字原文摘录），
 * 摘录缺省回退整段原文落 quote（翻翻卡背面）。书名（卡包标题）必填。
 * 自动入库：通过的卡全部写入 UserCard（个人资产，可删除，可加入复习周期）
 *
 * 请求体：
 *   title 书名（必填，≤60 字，作为卡包标题）
 *   text  必填，OCR 文本（30–8000 字）
 *
 * 卡数由 AI 按内容密度自行判断（1–10 张），端上不传/忽略卡数参数。
 *
 * 积分闸门：每次生成预扣 CARD_COST 分（生成失败退款；余额行缺失惰性补初始赠送）。
 * 非会员初始 30 分 = 3 次生成；会员月卡发货自动充值 1000 分。
 *
 * 返回：{ cards: [{ id?, module, title, recast, quote }] }；402 insufficient_credits = 积分不足
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    title?: string
    text?: string
  }
  const text = (body.text ?? '').trim()
  if (text.length < 30) return NextResponse.json({ error: 'text_too_short' }, { status: 400 })
  if (text.length > 8000) return NextResponse.json({ error: 'text_too_long' }, { status: 400 })

  // 书名（卡包标题）必填
  const title = (body.title ?? '').trim().slice(0, 60)
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 })

  if (llmProvider() === 'mock') {
    return NextResponse.json({ error: 'llm_not_configured' }, { status: 503 })
  }

  // 积分闸门：每次生成预扣 CARD_COST 分（余额不足 402 拦截；条件更新防并发透支）
  await ensureCredits(userId)
  if (!(await deductCredits(userId, CARD_COST))) {
    return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 })
  }

  try {
    const report = await generateCards({ title, text })
    if (report.cards.length === 0) {
      await refundCredits(userId, CARD_COST)
      return NextResponse.json({ error: 'generate_failed' }, { status: 502 })
    }
    // 自动入库：通过的卡全部落 UserCard。入库失败不吞掉生成结果——降级为不带回 id 返回
    // quote = 该卡对应的逐字原文摘录；AI 未摘出时回退整段原文
    const cards: { id?: string; module: string; title: string; recast: string; quote: string }[] = []
    try {
      for (const c of report.cards) {
        const quote = c.quote?.trim() || text
        const row = await prisma.userCard.create({
          data: {
            userId,
            sourceTitle: title,
            module: c.module,
            title: c.name,
            recast: c.recast,
            quote,
          },
        })
        cards.push({ id: row.id, module: c.module, title: c.name, recast: c.recast, quote })
      }
    } catch (e) {
      console.error('[cards/generate] 入库失败，降级返回', e)
      return NextResponse.json({ cards: report.cards.map((c) => ({ module: c.module, title: c.name, recast: c.recast, quote: c.quote?.trim() || text })) })
    }
    return NextResponse.json({ cards })
  } catch (e) {
    await refundCredits(userId, CARD_COST)
    console.error('[cards/generate]', e)
    return NextResponse.json({ error: 'generate_failed' }, { status: 502 })
  }
}
