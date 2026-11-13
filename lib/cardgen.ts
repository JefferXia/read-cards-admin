/**
 * 知识卡生成（短文片段场景）
 *
 * 输入：书名 + 作者 + 一段文字（拍照 OCR 得到，通常几十到几百字）
 * 输出：知识卡数组（GenCard，与 DataCard 契约对齐）+ 生成报告
 *
 * 设计要点：
 * - 单次 LLM 调用；卡数按文本长度自适应（几百字 → 3–5 张），宁缺毋滥
 * - 引文回验是机器比人强的点：quote 必须能在原文中定位（精确子串或
 *   二元组窗口重叠 ≥0.85），失败直接丢弃该卡 —— OCR 的小误差由模糊匹配兜底
 */
import { chatJson, extractJson, llmProvider, type ChatMessage } from './llm'

export interface GenCard {
  module: string
  name: string
  definition: string
  quote: string
  source: string
  reconstruct: string
  trigger: string
  boundaries: string[]
}

export interface GenOptions {
  title: string
  author?: string
  text: string
  /** 目标卡数：3–15，缺省按文本长度自适应（suggestCardCount） */
  targetCards?: number
  /** 片段来源标注（如「第X章」），缺省用「原文」 */
  chapterLabel?: string
}

export interface GenReport {
  cards: GenCard[]
  dropped: { name: string; reason: string }[]
  /** 引文校验结果：exact / fuzzy */
  quoteChecks: { name: string; mode: string }[]
  stages: string[]
  provider: string
}

/** 按文本长度建议卡数：短文字少卡少，宁精勿多 */
export function suggestCardCount(textLen: number): number {
  if (textLen <= 200) return 3
  if (textLen <= 500) return 4
  if (textLen <= 1200) return 6
  if (textLen <= 3000) return 8
  return 10
}

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

// ---------- 卡片生成 prompt ----------

function systemPrompt(title: string, author: string): string {
  return `你是精读助手。读者给你一段文字（《${title}》，${author}），你从中提炼知识卡。

先通读全文，想清楚这段文字真正讲了哪几个核心要点——一个要点一张卡，只挑真正值得记住的：
- 独立成立的观点、洞见、方法或关键概念
- 卡与卡之间不重复、不互相包含
- 宁精勿多：原文信息少就少出卡，一两张也完全可以，绝不硬凑、不把一段话拆成碎卡

每张卡的字段：
- module：2–4 字，从内容出发给这张卡归类（它在讲什么主题/维度，如「道体」「治国」「沟通」），贴着这段文字自己的语言来，不要用空泛的通用词
- name：卡名，10 字以内，一眼看出这张卡在说什么
- definition：一句话定义（副标题），不超过 60 字
- quote：逐字摘自原文（不超过 150 字），不要改写、不要加引号——这是最重要的字段，必须与原文完全一致
- source：出处标注，按原文中的标注来写；没有标注就写「原文」
- reconstruct：用现代语言重构：先把原文压缩到关键，再写出可操作的迁移价值。可用 **加粗** 标出关键句
- trigger：触发场景，固定格式「当你……时，问：……？」
- boundaries：2-3 条边界，描述「这不是什么」与「误用风险：……」

输出 JSON：{"cards":[{...}]}。不要输出 JSON 以外的任何文字。`
}

// ---------- 引文回验 ----------

/** 归一化：去空白、统一/去掉引号、去标点，用于 quote 与原文的比对 */
function normalize(s: string): string {
  return s
    .replace(/[\s\u3000]+/g, '')
    .replace(/[“”„‟「」『』]/g, '')
    .replace(/[，,。.！!？?；;：:、·]/g, '')
    .toLowerCase()
}

function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

/**
 * 模糊匹配：以 quote 的首二元组在原文中定位候选起点，逐窗口算
 * 二元组重叠率（≥0.85 通过）。窗口前后各放宽 4 字，容忍少量标点差异。
 */
function fuzzyQuoteMatch(textNorm: string, quoteNorm: string): boolean {
  if (quoteNorm.length < 8) return false
  const q = bigrams(quoteNorm)
  const qSet = new Set(q)
  const positions: number[] = []
  let idx = textNorm.indexOf(q[0])
  while (idx >= 0 && positions.length < 50) {
    positions.push(idx)
    idx = textNorm.indexOf(q[0], idx + 1)
  }
  for (const pos of positions) {
    const win = textNorm.slice(pos - 4, pos + quoteNorm.length + 4)
    const wSet = new Set(bigrams(win))
    let hit = 0
    for (const b of qSet) if (wSet.has(b)) hit++
    if (hit / qSet.size >= 0.85) return true
  }
  return false
}

export interface QuoteCheck {
  ok: boolean
  mode: 'exact' | 'fuzzy' | 'fail'
  reason: string
}

export function verifyQuote(quote: string, textNorm: string): QuoteCheck {
  const q = normalize(quote)
  if (!q) return { ok: false, mode: 'fail', reason: 'quote 为空' }
  if (q.length < 8) return { ok: false, mode: 'fail', reason: 'quote 太短' }
  if (textNorm.includes(q)) return { ok: true, mode: 'exact', reason: 'exact' }
  if (fuzzyQuoteMatch(textNorm, q)) return { ok: true, mode: 'fuzzy', reason: 'fuzzy' }
  return { ok: false, mode: 'fail', reason: 'quote 与原文不符' }
}

// ---------- 主入口 ----------

interface RawCard {
  module?: string
  name?: string
  definition?: string
  quote?: string
  source?: string
  reconstruct?: string
  trigger?: string
  boundaries?: string[]
}

export async function generateCards(opts: GenOptions): Promise<GenReport> {
  const provider = llmProvider()
  const stages: string[] = []
  const targetCards = Math.min(15, Math.max(3, opts.targetCards ?? suggestCardCount(opts.text.length)))
  const label = opts.chapterLabel || '原文'

  stages.push(`片段 ${opts.text.length} 字 → 目标 ${targetCards} 张（单次调用）`)

  const sys = systemPrompt(opts.title, opts.author || '未知作者')
  const user = `以下是《${opts.title}》的片段（${label}）：

${opts.text}

请提炼最多 ${targetCards} 张知识卡。宁精勿多，值得出的才出。`

  stages.push('调用 LLM 提取卡片…')
  const data = await callJson<{ cards: RawCard[] }>(sys, user)
  const rawCards = data.cards ?? []
  stages.push(`LLM 返回 ${rawCards.length} 张卡`)

  const textNorm = normalize(opts.text)
  const dropped: { name: string; reason: string }[] = []
  const quoteChecks: { name: string; mode: string }[] = []
  const cards: GenCard[] = []

  for (const c of rawCards) {
    if (!c.name || !c.definition || !c.quote || !c.reconstruct || !c.trigger) {
      dropped.push({ name: c.name ?? '?', reason: '字段缺失' })
      continue
    }
    const check = verifyQuote(c.quote, textNorm)
    if (!check.ok) {
      dropped.push({ name: c.name, reason: check.reason })
      continue
    }
    quoteChecks.push({ name: c.name, mode: check.mode })
    cards.push({
      module: c.module || '要点',
      name: c.name,
      definition: c.definition,
      quote: c.quote,
      source: c.source || label,
      reconstruct: c.reconstruct,
      trigger: c.trigger,
      boundaries: Array.isArray(c.boundaries) ? c.boundaries : [],
    })
  }
  stages.push(`引文回验：${cards.length} 通过，${dropped.length} 丢弃`)

  return { cards, dropped, quoteChecks, stages, provider }
}
