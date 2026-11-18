import { NextResponse } from 'next/server'
import { head, put } from '@vercel/blob'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { synthesize, ttsObjectKey, TTS_TEXT_MAX } from '@/lib/tts'

export const runtime = 'nodejs'
/** 合成 + 转存最长 60s：Vercel Hobby 上限，需在函数配置里显式声明 */
export const maxDuration = 60

/**
 * POST /api/tts —— 朗读文本 → 语音（MiniMax speech-2.8-hd）
 *
 * 用法：
 * - { cardId, kind? }：卡片朗读。kind='card' 只查全局书卡；kind='user' 只查本人自建卡
 *   （各只做一次查询）；缺省 = 先全局后自建级联（兼容旧调用方）。
 *   首次以卡的重构阐释（recast）合成 → 转存 Vercel Blob → 地址/时长回写
 *   Card/UserCard.audioUrl/audioMs；之后请求直读库返回，不再合成。
 * - { text }：任意文本即席合成（不做落库，仅按对象键去重）。
 *
 * 链路：t2a_v2（hex 回传音频）→ 服务端解码 → 转存 Vercel Blob → 返回自有长期 URL。
 * 对象键 = 文本+音色+模型 sha256（确定性命名）：同一段文字命中已有对象不再计费合成；
 * put 关闭随机后缀，同键覆盖、URL 永不失效。
 *
 * 返回：{ url, durationMs, cached }（durationMs 毫秒，Blob 键命中时为 null）
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { text?: string; cardId?: string; kind?: 'card' | 'user' }

  // 朗读目标：已有音频直读库；否则取重构阐释为文本，合成后回写落库
  let card: { id: string } | null = null
  let userCard: { id: string } | null = null
  let text = (body.text ?? '').trim()
  if (body.cardId) {
    if (body.kind !== 'user') {
      const row = await prisma.card.findFirst({
        where: { id: body.cardId, status: 'APPROVED' },
        select: { id: true, recast: true, audioUrl: true, audioMs: true },
      })
      if (row) {
        if (row.audioUrl) return NextResponse.json({ url: row.audioUrl, durationMs: row.audioMs, cached: true })
        card = { id: row.id }
        text = row.recast.trim()
      } else if (body.kind === 'card') {
        // 调用方已声明是全局卡：不回退查自建卡（省一次查询）
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }
    }
    if (!card) {
      // 自建认知卡：必须归属当前用户（隔离朗读，防止跨用户读别人的卡）
      const uc = await prisma.userCard.findFirst({
        where: { id: body.cardId, userId },
        select: { id: true, recast: true, audioUrl: true, audioMs: true },
      })
      if (!uc) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      if (uc.audioUrl) return NextResponse.json({ url: uc.audioUrl, durationMs: uc.audioMs, cached: true })
      userCard = { id: uc.id }
      text = uc.recast.trim()
    }
  }
  if (!text) return NextResponse.json({ error: 'text_required' }, { status: 400 })
  if (text.length > TTS_TEXT_MAX) return NextResponse.json({ error: 'text_too_long' }, { status: 400 })

  if (!process.env.MINIMAX_API_KEY) return NextResponse.json({ error: 'tts_not_configured' }, { status: 503 })
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'storage_not_configured' }, { status: 503 })
  }

  try {
    const pathname = `tts/${ttsObjectKey(text)}.mp3`

    // 命中缓存：同文本已转存过，直接回放（未命中各 SDK 版本行为不一：返回 null 或抛错，两种都当未命中）
    try {
      const existing = await head(pathname)
      if (existing?.url) return NextResponse.json({ url: existing.url, durationMs: null, cached: true })
    } catch {
      /* 未命中，继续合成 */
    }

    const audio = await synthesize(text)
    const blob = await put(pathname, audio.buffer, {
      access: 'public',
      contentType: 'audio/mpeg',
      addRandomSuffix: false,
    })
    // 书卡/自建卡朗读：地址/时长回写对应表，之后请求直读库返回，不再合成
    if (card) {
      await prisma.card.update({
        where: { id: card.id },
        data: { audioUrl: blob.url, audioMs: audio.durationMs },
      })
    } else if (userCard) {
      await prisma.userCard.update({
        where: { id: userCard.id },
        data: { audioUrl: blob.url, audioMs: audio.durationMs },
      })
    }
    return NextResponse.json({ url: blob.url, durationMs: audio.durationMs, cached: false })
  } catch (e) {
    console.error('[api/tts]', e)
    return NextResponse.json({ error: 'tts_failed' }, { status: 502 })
  }
}
