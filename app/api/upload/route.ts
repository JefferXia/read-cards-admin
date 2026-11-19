import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import COS from 'cos-nodejs-sdk-v5'
import { currentUserId } from '@/lib/auth'

export const runtime = 'nodejs'

/** 上限 8MB：OCR 前端已压缩到数百 KB，这里只挡异常大文件 */
const MAX_SIZE = 8 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** COS 配置（环境变量）：桶名需带 appid 后缀（如 xxx-125xxxxxxx），地域如 ap-nanjing */
function cosConfig() {
  return {
    SecretId: process.env.COS_SECRETID ?? '',
    SecretKey: process.env.COS_SECRETKEY ?? '',
    Bucket: process.env.COS_BUCKET ?? '',
    Region: process.env.COS_REGION ?? '',
  }
}

/** COS 客户端单例（模块级复用，避免每次请求重建） */
let cosClient: COS | null = null
function getCos(): COS {
  if (!cosClient) {
    const { SecretId, SecretKey } = cosConfig()
    cosClient = new COS({ SecretId, SecretKey })
  }
  return cosClient
}

/** putObject 上传 Buffer（Promise 包装回调式 SDK） */
function putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  const { Bucket, Region } = cosConfig()
  return new Promise((resolve, reject) => {
    getCos().putObject({ Bucket, Region, Key: key, Body: body, ContentType: contentType }, (err) =>
      err ? reject(err) : resolve(),
    )
  })
}

/**
 * POST /api/upload —— 通用图片上传（multipart/form-data，字段名 file）
 *
 * 用途：小程序「拍照识别文字」先把图上传拿到可公网访问的 https 地址，
 * 再把地址作为 img_url 传给服务市场 OCR（官方示例只收网络 URL，不收本地文件）。
 *
 * 鉴权：登录用户（cookie）；存储：腾讯云 COS（ocr/<userId>/<时间戳>-<随机>.<ext>）。
 * 桶需开公共读（OCR 服务端直接拉取该 URL，无签名）；返回：{ url }。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { Bucket, Region } = cosConfig()
  if (!process.env.COS_SECRETID || !process.env.COS_SECRETKEY || !Bucket || !Region) {
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
    const key = `ocr/${userId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    await putBuffer(key, Buffer.from(await file.arrayBuffer()), file.type)
    // URL 自拼（SDK data.Location 新版本不带协议头，不如直接构造可靠）
    const url = `https://${Bucket}.cos.${Region}.myqcloud.com/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
    return NextResponse.json({ url })
  } catch (e) {
    console.error('[api/upload]', e)
    return NextResponse.json({ error: 'upload_failed' }, { status: 502 })
  }
}
