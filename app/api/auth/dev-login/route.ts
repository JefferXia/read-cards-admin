import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { setSessionCookie } from '@/lib/auth'

export const runtime = 'nodejs'

/** 仅当微信未配置时开放：本地/朋友内测前的开发联调入口 */
export async function POST(req: Request) {
  if (process.env.WX_APPID && process.env.WX_SECRET) {
    return NextResponse.json({ error: 'dev login disabled' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { nickname?: string }
  const openid = `dev::${body.nickname ?? 'tester'}`
  const user = await prisma.user.upsert({
    where: { openId: openid },
    update: {},
    create: { openId: openid, nickname: body.nickname ?? 'tester' },
  })
  await setSessionCookie(user.id)
  return NextResponse.json({ ok: true, userId: user.id })
}
