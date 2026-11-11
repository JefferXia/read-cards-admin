/**
 * 微信开放能力封装：
 *  - code2Session：wx.login 的 code 换 openid
 *  - msgSecCheck：UGC 文本安全校验（对谈输入前置）
 *
 * 未配置 WX_APPID 时一切返回降级结果，本地用 dev-login 联调。
 */

export interface WxSession {
  openid: string
  session_key?: string
}

export async function code2Session(code: string): Promise<WxSession | null> {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) return null
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}` +
    `&secret=${secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as { openid?: string; errcode?: number }
  if (!data.openid) return null
  return { openid: data.openid }
}

export interface SecCheckResult {
  pass: boolean
  /** 命中风险类别，用于给用户一个温和的解释 */
  label?: string
}

export async function msgSecCheck(_openid: string, content: string): Promise<SecCheckResult> {
  // 未配置微信时本地放行（/mock 一并覆盖）
  if (!process.env.WX_APPID || !process.env.WX_SECRET) return { pass: true }
  try {
    const tokenUrl =
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
      `&appid=${process.env.WX_APPID}&secret=${process.env.WX_SECRET}`
    const tokenRes = (await (await fetch(tokenUrl)).json()) as { access_token?: string }
    if (!tokenRes.access_token) return { pass: true }
    const res = await fetch(
      `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${tokenRes.access_token}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, version: 2, scene: 2, openid: _openid }),
      },
    )
    const data = (await res.json()) as {
      result?: { suggest?: string; label?: number }
    }
    const suggest = data.result?.suggest ?? 'pass'
    return suggest === 'pass' ? { pass: true } : { pass: false, label: String(data.result?.label) }
  } catch {
    // 安全校验失败不应阻塞对话（微信侧抖动），宁可放过
    return { pass: true }
  }
}
