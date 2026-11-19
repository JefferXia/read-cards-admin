import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { currentUserId } from '@/lib/auth'

export const runtime = 'nodejs'

/** 上限 8MB：OCR 前端已压缩到数百 KB，这里只挡异常大文件 */
const MAX_SIZE = 8 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * POST /api/upload —— 通用图片上传（multipart/form-data，字段名 file）
 *
 * 用途：小程序「拍照识别文字」先把图上传拿到可公网访问的 https 地址，
 * 再把地址作为 img_url 传给服务市场 OCR（官方示例只收网络 URL，不收本地文件）。
 *
 * 鉴权：登录用户（cookie）；存储：Vercel Blob（ocr/<userId>/<时间戳>-<随机>.<ext>）。
 * 返回：{ url }
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'storage_not_configured' }, { status: 503 })
  }

  let file: File | null = null
  try {
    file = (await req.formData()).get('file') as File | null
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 })
  }
  if (!file.type.startsWith('image/') || !(file.type in EXT_BY_MIME)) {
    return NextResponse.json({ error: 'bad_file_type' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 })
  }

  try {
    const ext = EXT_BY_MIME[file.type]
    const pathname = `ocr/${userId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    const blob = await put(pathname, await file.arrayBuffer(), {
      access: 'public',
      contentType: file.type,
    })
    return NextResponse.json({ url: blob.url })
  } catch (e) {
    console.error('[api/upload]', e)
    return NextResponse.json({ error: 'upload_failed' }, { status: 502 })
  }
}
