/**
 * MiniMax 语音合成（/v1/t2a_v2）客户端
 *
 * 朗读卡片阐释：非流式 + output_format=hex（音频字节随 JSON 返回），
 * 服务端解码后转存对象存储（Vercel Blob），返回长期有效的自有 URL——
 * 不用官方 url 格式（24 小时过期，无法沉淀复用）。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

const BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.cn'
export const TTS_MODEL = 'speech-2.8-hd'
/** 默认音色（御姐音，适合知识朗读）；可用 MINIMAX_TTS_VOICE 覆盖 */
export const TTS_VOICE = process.env.MINIMAX_TTS_VOICE ?? 'female-yujie'

/** 朗读文本上限（字符）：阐释 2–4 句远用不满，防御性兜底 */
export const TTS_TEXT_MAX = 2000

export interface TtsAudio {
  buffer: Buffer
  /** 音频时长（毫秒，官方 extra_info.audio_length） */
  durationMs: number | null
  model: string
  voice: string
}

/**
 * 合成语音：文本 → mp3 字节。
 * 业务错误在 base_resp（HTTP 仍 200），须显式检查 status_code。
 */
export async function synthesize(text: string): Promise<TtsAudio> {
  const res = await fetch(`${BASE_URL}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MINIMAX_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      text,
      stream: false,
      output_format: 'hex', // 默认即 hex，显式声明防上游变更
      voice_setting: { voice_id: TTS_VOICE, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
    }),
    // Vercel maxDuration 60s 内留出转存余量
    signal: AbortSignal.timeout(50_000),
  })
  if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}`)
  const data = (await res.json()) as {
    data?: { audio?: string }
    extra_info?: { audio_length?: number }
    base_resp?: { status_code?: number; status_msg?: string }
  }
  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax ${data.base_resp.status_code}: ${data.base_resp.status_msg ?? 'tts_failed'}`)
  }
  const buffer = Buffer.from(data.data?.audio ?? '', 'hex')
  if (buffer.length === 0) throw new Error('MiniMax 返回空音频')
  return { buffer, durationMs: data.extra_info?.audio_length ?? null, model: TTS_MODEL, voice: TTS_VOICE }
}

/**
 * 音频对象键：文本+音色+模型的 sha256，确定性命名。
 * 同一段文字重复朗读 → 同一对象键，直接命中已转存音频，不再重复调 MiniMax 计费。
 */
export function ttsObjectKey(text: string): string {
  return createHash('sha256').update(`v1|${TTS_MODEL}|${TTS_VOICE}|${text}`).digest('hex')
}
