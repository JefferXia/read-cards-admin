/**
 * 本地批量回填卡片语音：audioUrl 为空的卡 → MiniMax 合成 → Vercel Blob 转存 → 回写 DB
 *
 * 用法：cd /Users/xia/ai/yinian-read-web && node --env-file=.env scripts/tts-backfill.mjs [最多处理张数]
 * 不传张数 = 跑完全部。可随时 Ctrl+C 中断重跑：已回写 audioUrl 的卡不会再被取到，不重复合成计费。
 * 并发：TTS_CONCURRENCY（默认 3）；音色：MINIMAX_TTS_VOICE ?? female-yujie
 * （音色/模型绑定对象键，中途换音色已合成的不会重跑——键不同会当成新文本重新合成）。
 */
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { head, put } from '@vercel/blob'

const MODEL = 'speech-2.8-hd'
const VOICE = process.env.MINIMAX_TTS_VOICE ?? 'female-yujie'
const BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.cn'
const MAX = Number(process.argv[2]) || Infinity
const CONCURRENCY = Math.max(1, Number(process.env.TTS_CONCURRENCY) || 3)

const prisma = new PrismaClient()

/** 与 lib/tts.ts 同逻辑：t2a_v2 非流式，hex 回传音频字节 */
async function synthesize(text) {
  const res = await fetch(`${BASE_URL}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MINIMAX_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: MODEL,
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: { voice_id: VOICE, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
    }),
    signal: AbortSignal.timeout(50_000),
  })
  if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}`)
  const data = await res.json()
  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax ${data.base_resp.status_code}: ${data.base_resp.status_msg ?? 'tts_failed'}`)
  }
  const buffer = Buffer.from(data.data?.audio ?? '', 'hex')
  if (buffer.length === 0) throw new Error('MiniMax 返回空音频')
  return { buffer, durationMs: data.extra_info?.audio_length ?? null }
}

/** 与 lib/tts.ts 同逻辑：文本+音色+模型 sha256，确定性键命中即免合成 */
const objectKey = (text) => createHash('sha256').update(`v1|${MODEL}|${VOICE}|${text}`).digest('hex')

async function main() {
  if (!process.env.MINIMAX_API_KEY || !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('缺 MINIMAX_API_KEY 或 BLOB_READ_WRITE_TOKEN（检查 .env）')
  }
  const total = await prisma.card.count({ where: { audioUrl: null } })
  const list = await prisma.card.findMany({
    where: { audioUrl: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, title: true, recast: true },
  })
  const targets = Number.isFinite(MAX) ? list.slice(0, MAX) : list
  console.log(
    `待处理 ${total} 张 · 本轮 ${targets.length} 张 · 并发 ${CONCURRENCY} · 音色 ${VOICE}`,
  )

  const t0 = Date.now()
  const skippedTitles = []
  let done = 0
  let failed = 0
  let next = 0

  async function worker() {
    for (;;) {
      const i = next++
      if (i >= targets.length) return
      const c = targets[i]
      const text = (c.recast ?? '').trim()
      if (!text) {
        skippedTitles.push(c.title)
        done++
        continue
      }
      try {
        const pathname = `tts/${objectKey(text)}.mp3`
        // 同文本已转存过：直接回写 URL，不再计费合成（命中缓存拿不到时长，audioMs 留空）
        let url = null
        try {
          const existing = await head(pathname)
          url = existing?.url ?? null
        } catch {
          /* 未命中，继续合成 */
        }
        let durationMs = null
        if (!url) {
          const audio = await synthesize(text)
          const blob = await put(pathname, audio.buffer, {
            access: 'public',
            contentType: 'audio/mpeg',
            addRandomSuffix: false,
          })
          url = blob.url
          durationMs = audio.durationMs
        }
        await prisma.card.update({
          where: { id: c.id },
          data: durationMs != null ? { audioUrl: url, audioMs: durationMs } : { audioUrl: url },
        })
        done++
        console.log(
          `[${done}/${targets.length}] ${c.title} ✓ ${
            durationMs != null ? `${durationMs}ms` : '缓存命中'
          } (${Math.round((Date.now() - t0) / 1000)}s)`,
        )
      } catch (e) {
        done++
        failed++
        console.error(`[${done}/${targets.length}] ${c.title} ✗ ${e.message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))

  const remaining = await prisma.card.count({ where: { audioUrl: null } })
  console.log(
    `\n本轮结束：成功 ${targets.length - failed - skippedTitles.length} · 空阐释 ${skippedTitles.length} · 失败 ${failed} · 仍缺语音 ${remaining}`,
  )
  if (skippedTitles.length) console.log('空阐释卡：' + skippedTitles.join('、'))
  if (remaining > 0) console.log('仍有缺语音的卡，重跑本脚本可续传/重试')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
