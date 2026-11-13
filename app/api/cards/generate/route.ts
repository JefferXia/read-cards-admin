import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateCards } from '@/lib/cardgen'
import { llmProvider } from '@/lib/llm'

export const runtime = 'nodejs'
/** LLM 调用最长 60s：Vercel Hobby 上限 60s，需在函数配置里显式声明 */
export const maxDuration = 60

/**
 * POST /api/cards/generate { text, title?, author?, cards? } —— 拍照识别文本 → 知识卡
 *
 * 小程序端 OCR（书页/白板/讲义）拿到一段文字后调用本接口，实时生成知识卡：
 * - 单次 LLM 调用；卡数按文本长度自适应（几百字 → 3–5 张），宁缺毋滥
 * - 自动入库：通过引文回验的卡全部写入 UserCard（个人资产，可删除，不进全局学习流）
 * - 引文回验：quote 必须能在原文中定位（精确子串或模糊窗口 ≥0.85），
 *   定位失败的卡直接丢弃，不进返回结果 —— OCR 的小误差由模糊匹配兜底
 *
 * 请求体：
 *   text   必填，OCR 文本（30–8000 字）
 *   title  可选，来源标注（如「关键对话 第3章」），缺省「未命名片段」
 *   author 可选，缺省「未知作者」
 *   cards  可选，目标卡数（3–15），缺省按文本长度自适应
 *
 * 返回：{ cards: [{ module, name, definition, quote, source, reconstruct, trigger, boundaries[] }] }
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    text?: string
    title?: string
    author?: string
    cards?: number
  }
  const text = (body.text ?? '').trim()
  if (text.length < 30) return NextResponse.json({ error: 'text_too_short' }, { status: 400 })
  if (text.length > 8000) return NextResponse.json({ error: 'text_too_long' }, { status: 400 })

  const title = (body.title ?? '').trim().slice(0, 60) || '未命名片段'
  const author = (body.author ?? '').trim().slice(0, 60) || '未知作者'
  const targetCards = typeof body.cards === 'number' ? Math.min(15, Math.max(3, body.cards)) : undefined

  if (llmProvider() === 'mock') {
    return NextResponse.json({ error: 'llm_not_configured' }, { status: 503 })
  }

  try {
    const report = await generateCards({ title, author, text, targetCards })
    // 自动入库：通过的卡全部落 UserCard。入库失败不吞掉生成结果——降级为不带回 id 返回
    try {
      const cards = []
      for (const c of report.cards) {
        const row = await prisma.userCard.create({
          data: {
            userId,
            sourceTitle: title,
            sourceAuthor: author,
            module: c.module,
            title: c.name,
            definition: c.definition,
            quote: c.quote,
            recast: c.reconstruct,
            trigger: c.trigger,
            boundaries: c.boundaries,
            source: c.source,
          },
        })
        cards.push({ id: row.id, ...c })
      }
      return NextResponse.json({ cards })
    } catch (e) {
      console.error('[cards/generate] 入库失败，降级返回', e)
      return NextResponse.json({ cards: report.cards })
    }
  } catch (e) {
    console.error('[cards/generate]', e)
    return NextResponse.json({ error: 'generate_failed' }, { status: 502 })
  }
}
