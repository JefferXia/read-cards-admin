/**
 * 搜索书单 —— 带着困惑选书
 *
 * 输入用户当下的困惑，从书库全部书（不分 DRAFT/ACTIVE/ARCHIVED 状态）中
 * 选出最契合的一本，并给一句推荐理由。素材为各书已上架（APPROVED）卡片的「卡名+定义」。
 * LLM 不可用（mock / 超时 / 解析失败 / 选到不存在的书）时，
 * 退化为困惑与书文本的二元组重合度启发式（同 judge 的 mock 思路），保证接口必返。
 */

import { prisma } from './db'
import { chatJson, extractJson, llmProvider, type ChatMessage } from './llm'

export interface CandidateBook {
  id: string
  title: string
  subtitle: string | null
  author: string
  tagline: string | null
}

export interface BookPick {
  book: CandidateBook | null
  reason: string
}

type CandidateWithCards = CandidateBook & {
  chapters: { cards: { title: string; definition: string }[] }[]
}

async function loadCandidates(): Promise<CandidateWithCards[]> {
  return prisma.book.findMany({
    include: {
      chapters: {
        orderBy: { idx: 'asc' },
        select: {
          cards: {
            where: { status: 'APPROVED' },
            orderBy: { idx: 'asc' },
            select: { title: true, definition: true },
          },
        },
      },
    },
  })
}

function pickMessages(confusion: string, books: CandidateWithCards[]): ChatMessage[] {
  const list = books
    .map((b) => {
      const lines = b.chapters
        .flatMap((ch) => ch.cards)
        .map((c) => `- ${c.title}：${c.definition}`)
        .join('\n')
      return [
        `【${b.title}】${b.author}`,
        `id=${b.id}`,
        b.tagline ? `推荐语：${b.tagline}` : '',
        `收录观念卡：\n${lines || '（暂无上架卡片）'}`,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')

  return [
    {
      role: 'system',
      content: `你是一念·精读的选书助手。用户带来一个当下的困惑，你要从候选书单中挑出最契合他的一本书。

挑选标准：哪本书收录的观念卡最能回应他的困惑就选哪本，不要因为是经典就硬推。

严格输出 JSON：{"bookId":"所选项的 id","reason":"推荐理由"}
reason 要求：不超过 40 字，口语中文，直接点出这本书和他的困惑的关系，像朋友说话，不要客套。`,
    },
    { role: 'user', content: `【用户的困惑】\n${confusion}\n\n【候选书单】\n${list}` },
  ]
}

/* ------------------------------------------------------------------ */
/* 本地兜底：二元组重合度（与 judge 的 mock 同思路）                     */
/* ------------------------------------------------------------------ */

function tokenize(s: string): Set<string> {
  const clean = s.replace(/[，。！？、：；""''（）《》\s,.!?]/g, '')
  const set = new Set<string>()
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2))
  return set
}

function overlapScore(confusion: string, texts: string[]): number {
  const q = tokenize(confusion)
  if (q.size === 0) return 0
  const ref = tokenize(texts.join(' '))
  let hit = 0
  for (const t of q) if (ref.has(t)) hit++
  return hit / q.size
}

function fallbackReason(book: CandidateBook): string {
  return `先从《${book.title}》读起，它和你的困惑离得最近。`
}

/**
 * 按困惑选书。无在架书时 book=null；LLM 路径任何失败都落到本地启发式。
 */
export async function pickBook(confusion: string): Promise<BookPick> {
  const candidates = await loadCandidates()
  if (candidates.length === 0) return { book: null, reason: '' }

  const slim = (b: CandidateWithCards): CandidateBook => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    author: b.author,
    tagline: b.tagline,
  })

  if (llmProvider() !== 'mock') {
    try {
      const raw = await chatJson(pickMessages(confusion, candidates))
      const parsed = extractJson<{ bookId?: string; reason?: string }>(raw.text)
      const hit = parsed?.bookId ? candidates.find((b) => b.id === parsed.bookId) : undefined
      if (hit) {
        const reason = String(parsed?.reason ?? '')
          .trim()
          .slice(0, 60)
        return { book: slim(hit), reason: reason || fallbackReason(hit) }
      }
    } catch {
      // 网络 / 解析失败：落到本地启发式
    }
  }

  const best = candidates
    .map((b) => ({
      book: b,
      score: overlapScore(confusion, [
        b.title,
        b.subtitle ?? '',
        b.tagline ?? '',
        ...b.chapters.flatMap((ch) => ch.cards.map((c) => `${c.title}${c.definition}`)),
      ]),
    }))
    .sort((x, y) => y.score - x.score)[0].book
  return { book: slim(best), reason: fallbackReason(best) }
}
