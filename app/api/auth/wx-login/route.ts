import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { code2Session } from '@/lib/wx'
import { setSessionCookie, randomNickname } from '@/lib/auth'

export const runtime = 'nodejs'

/** POST { code } —— wx.login 的 code 换 openid，静默建号 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { code?: string }
  if (!body.code) return NextResponse.json({ error: 'missing code' }, { status: 400 })

  const session = await code2Session(body.code)
  if (!session) {
    return NextResponse.json(
      { error: 'wx_not_configured_or_invalid', hint: '本地联调请走 /api/auth/dev-login' },
      { status: 503 },
    )
  }

  const user = await prisma.user.upsert({
    where: { openId: session.openid },
    update: {},
    create: { openId: session.openid, nickname: randomNickname() },
  })
  // 存量用户昵称兜底（早期建号未写入昵称，下次登录补上）
  if (!user.nickname) {
    await prisma.user.update({ where: { id: user.id }, data: { nickname: randomNickname() } })
  }
  await setSessionCookie(user.id)
  return NextResponse.json({ ok: true, userId: user.id })
}
