/**
 * LLM provider 抽象 —— 参照 ai-app 的 provider 模式（deepseek/openrouter 直连）
 * 无密钥时降级为 mock：本地跑通全流程，上线前配置真实 provider。
 */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface LlmResult {
  text: string
  provider: string
}

const TIMEOUT_MS = 60_000

export function llmProvider(): 'deepseek' | 'openrouter' | 'mock' {
  const p = process.env.LLM_PROVIDER
  if (p === 'openrouter' && process.env.OPENROUTER_API_KEY) return 'openrouter'
  if (p === 'deepseek' && process.env.DEEPSEEK_API_KEY) return 'deepseek'
  return 'mock'
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        // 默认 4096 会被长 JSON 截断（parse 失败），显式提到模型上限 8192
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`LLM ${res.status}`)
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

export async function chatJson(messages: ChatMessage[]): Promise<LlmResult> {
  const provider = llmProvider()
  if (provider === 'deepseek') {
    const text = await callOpenAiCompatible(
      'https://api.deepseek.com/chat/completions',
      process.env.DEEPSEEK_API_KEY!,
      'deepseek-chat',
      messages,
    )
    return { text, provider }
  }
  if (provider === 'openrouter') {
    const text = await callOpenAiCompatible(
      'https://openrouter.ai/api/v1/chat/completions',
      process.env.OPENROUTER_API_KEY!,
      'deepseek/deepseek-chat',
      messages,
    )
    return { text, provider }
  }
  throw new Error('mock provider 不走 chatJson，请使用 judge 的 mock 分支')
}

export function extractJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (m) {
      try {
        return JSON.parse(m[0]) as T
      } catch {
        return null
      }
    }
    return null
  }
}
