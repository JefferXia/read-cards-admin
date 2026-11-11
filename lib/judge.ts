/**
 * 复习判分 —— 复习只做一遍
 *
 * 交互：出示卡名+定义 → 触发问句提问 → 用户用自己的话复述（一次）→
 * AI 按 10 分制打分（页面不透出），只透出三档结论：
 *   tier 0 有点遗忘（0-3）/ 1 记得一些（4-7）/ 2 很巩固（8-10）
 *
 * 不再用预埋 signals —— 由 AI 对照卡片的定义与重构阐释直接判断复述是否说到点子上。
 */

import { chatJson, extractJson, llmProvider, type ChatMessage } from './llm'

export interface JudgeCard {
  id: string
  title: string // 卡名
  definition: string // 定义（一句话命题）
  recast: string // 重构阐释（现代人话展开）
  trigger: string // 触发问句
}

export interface JudgeAnswer {
  score: number // 0–10（内部，不透出）
  tier: 0 | 1 | 2
  feedback: string // 一两句朋友口吻的点评
}

export function tierOfScore(score: number): 0 | 1 | 2 {
  return score >= 8 ? 2 : score >= 4 ? 1 : 0
}

function judgeSystemPrompt(card: JudgeCard): string {
  return `你是一位温和、有智慧的老朋友，帮用户检验他是否真正理解了一个观念。

观念：${card.title} —— ${card.definition}
背景阐释（供你对照，不要直接念给用户）：${card.recast}

用户会用自己的话复述这个观念。请按 10 分制评分：
- 9-10 = 准确转述了核心，还能联结自身经历或举出例子
- 7-8 = 用自己的话准确转述了核心
- 4-6 = 大方向对，但有含糊或偏差
- 1-3 = 沾边但没说到点子上
- 0 = 完全没提到（坦诚说"不记得"不算过错，给 1-2 分）

feedback：一两句话，口吻像朋友不像老师；说对了就肯定，欠缺就温和点出，禁止评判人格。
严格输出 JSON：{"score": number, "feedback": string}`
}

/** 单卡复述判分（provider=mock 时由 mockJudgeAnswer 顶替） */
export async function judgeAnswer(card: JudgeCard, answer: string): Promise<JudgeAnswer> {
  if (llmProvider() === 'mock') return mockJudgeAnswer(card, answer)

  const messages: ChatMessage[] = [
    { role: 'system', content: judgeSystemPrompt(card) },
    { role: 'user', content: `【用户的复述】\n${answer}` },
  ]
  const raw = await chatJson(messages)
  const parsed = extractJson<{ score?: number; feedback?: string }>(raw.text)
  const score = Math.max(0, Math.min(10, Math.round(Number(parsed?.score ?? 0))))
  return { score, tier: tierOfScore(score), feedback: String(parsed?.feedback ?? '') }
}

/* ------------------------------------------------------------------ */
/* mock 实现：本地无密钥时跑通闭环                                       */
/* ------------------------------------------------------------------ */

function tokenize(s: string): Set<string> {
  // 中文按 2-gram 切，去除无信息符号
  const clean = s.replace(/[，。！？、：；""''\s,.!?]/g, '')
  const set = new Set<string>()
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2))
  return set
}

function mockJudgeAnswer(card: JudgeCard, answer: string): JudgeAnswer {
  const ref = tokenize(`${card.title} ${card.definition} ${card.recast}`)
  const ans = tokenize(answer)
  let hit = 0
  for (const t of ans) if (ref.has(t)) hit++
  const overlap = ans.size ? hit / ans.size : 0

  let score = overlap > 0.35 ? 9 : overlap > 0.2 ? 7 : overlap > 0.1 ? 5 : overlap > 0.02 ? 3 : 1
  if (/(不知道|不记得|忘了|没印象)/.test(answer)) score = Math.min(score, 2)

  const tier = tierOfScore(score)
  return {
    score,
    tier,
    feedback:
      tier === 2
        ? '已经能用自己的话讲清楚，这条过关。'
        : tier === 1
          ? '大方向说对了，细节再夯实一下。'
          : '这条的印象淡了，回头把原文再翻一翻。',
  }
}
