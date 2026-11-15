/**
 * 认知卡生成（统一卡型）
 *
 * 输入：卡包标题（书名）+ 一段文字（拍照 OCR 或粘贴得到）
 * 输出：认知卡数组（module + 卡名 + 重构阐释）+ 生成报告
 *
 * 设计要点：
 * - 单次 LLM 调用；卡数由 AI 按内容密度自行判断（1–10 张），宁缺毋滥
 * - 原文整段作为 quote（翻翻卡背面），不做引文回验
 */
import { chatJson, extractJson, llmProvider, type ChatMessage } from './llm'

export interface GenCard {
  module: string
  name: string
  recast: string
}

export interface GenOptions {
  /** 卡包标题（书名） */
  title: string
  text: string
}

export interface GenReport {
  cards: GenCard[]
  dropped: { name: string; reason: string }[]
  stages: string[]
  provider: string
}

/** 卡数区间：由 AI 按内容密度自行判断，端上不按字数写死 */
export const CARD_COUNT_RANGE = { min: 1, max: 10 } as const

// ---------- LLM 调用 ----------

async function callJson<T>(system: string, user: string): Promise<T> {
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  // LLM 偶发返回残缺 JSON（截断/抖动），重试一次——这类失败返回很快，不会拖垮 60s 上限
  let lastErr: unknown = new Error('LLM 未调用')
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chatJson(messages)
    const data = extractJson<T>(res.text)
    if (data) return data
    lastErr = new Error(`LLM 返回不是合法 JSON：${res.text.slice(0, 200)}`)
  }
  throw lastErr
}

// ---------- 生成 prompt ----------

function systemPrompt(title: string): string {
  return `你是认知卡片助手。读者给你一段文字（《${title}》里的片段），你从中提炼「认知卡」。

认知卡是帮助读者把知识内化的卡片：正面是卡名，背面是原文与重构阐释。你只需要为每个值得记住的核心观点/概念/方法产出一行结构化摘要：

- module：2–4 字归类（这个观点属于什么主题/维度，如「道体」「处世」「沟通」），贴着这段文字自己的语言来，不要用空泛的通用词
- name：卡名，10 字以内，一眼看出这张卡在说什么
- recast：重构阐释，2–4 句。先把原文观点压缩到关键，再用现代语言写出可迁移的理解；不要直接抄原文

要求：
- 一个观点一张卡，卡与卡之间不重复、不互相包含
- 宁精勿多：原文信息少就少出卡，一两张也完全可以，绝不硬凑、不把一段话拆成碎卡

输出 JSON：{"cards":[{"module":"...","name":"...","recast":"..."}]}。不要输出 JSON 以外的任何文字。`
}

// ---------- 主入口 ----------

interface RawCard {
  module?: string
  name?: string
  recast?: string
}

export async function generateCards(opts: GenOptions): Promise<GenReport> {
  const provider = llmProvider()
  const stages: string[] = []

  stages.push(`片段 ${opts.text.length} 字（《${opts.title}》）→ 张数由 AI 判断（${CARD_COUNT_RANGE.min}–${CARD_COUNT_RANGE.max} 张，单次调用）`)

  const sys = systemPrompt(opts.title)
  const user = `以下是《${opts.title}》里的片段：

${opts.text}

请提炼认知卡。张数由你根据这段文字的内容密度判断，总共 1–10 张——一段话只讲一个道理就出 1 张；宁精勿多，值得出的才出，绝不硬凑。`

  stages.push('调用 LLM 提取认知卡…')
  const data = await callJson<{ cards: RawCard[] }>(sys, user)
  const rawCards = data.cards ?? []
  stages.push(`LLM 返回 ${rawCards.length} 张候选`)

  const dropped: { name: string; reason: string }[] = []
  const cards: GenCard[] = []
  const seen = new Set<string>()
  for (const c of rawCards) {
    if (!c.name || !c.recast) {
      dropped.push({ name: c.name ?? '(无卡名)', reason: '缺少卡名或重构阐释' })
      continue
    }
    if (seen.has(c.name)) {
      dropped.push({ name: c.name, reason: '卡名重复' })
      continue
    }
    seen.add(c.name)
    cards.push({
      module: (c.module ?? '').trim() || '认知',
      name: c.name,
      recast: c.recast,
    })
  }
  stages.push(`通过 ${cards.length} 张，丢弃 ${dropped.length} 张`)

  return { cards, dropped, stages, provider }
}
