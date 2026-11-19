import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/wxacode —— 小程序码（分享海报底部用），返回 base64 dataUrl
 * 走 wxa/getwxacodeunlimit 指向主页（check_path=false 跳过发布版校验，未发布版本也能出码）。
 * 结果按 scene 维度缓存在内存（同一码永久复用）；未配置 WX_APPID/WX_SECRET 时 503，端上退化为品牌占位。
 */
let cached: string | null = null
let tokenCache: { token: string; exp: number } | null = null

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) throw new Error('wx_not_configured')
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`,
  )
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('wx_token_failed')
  // 提前 5 分钟过期，避免临界点请求失败
  tokenCache = { token: data.access_token, exp: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000 }
  return tokenCache.token
}

export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (cached) return NextResponse.json({ dataUrl: cached })

  try {
    const token = await accessToken()
    const res = await fetch(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          page: 'pages/index/index', // 扫码落主页（领取今日书单），scene 只带来源
          scene: 'from=card', // 32 字符限制，含 [!#$&'()*+,/:;=?@-._~] 与字母数字
          width: 320,
          check_path: false, // 小程序未发布正式版时也能出码
        }),
      },
    )
    // 成功：二进制图片；失败：JSON { errcode, errmsg }
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { errcode?: number; errmsg?: string }
      return NextResponse.json(
        { error: 'wxacode_failed', detail: err.errmsg ?? '' },
        { status: 502 },
      )
    }
    const buf = Buffer.from(await res.arrayBuffer())
    cached = `data:image/png;base64,${buf.toString('base64')}`
    return NextResponse.json({ dataUrl: cached })
  } catch (e) {
    const notConfigured = e instanceof Error && e.message === 'wx_not_configured'
    return NextResponse.json(
      { error: notConfigured ? 'wx_not_configured' : 'wxacode_failed' },
      { status: notConfigured ? 503 : 502 },
    )
  }
}
