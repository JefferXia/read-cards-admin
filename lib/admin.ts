/**
 * 管理台鉴权：基于 NextAuth session（Credentials 'admin' 登录，session.user.role === 'admin'）。
 * 与小程序用户会话（lib/auth.ts 的 yr_session）完全隔离，互不干扰。
 */
import { auth } from '@/auth'

export async function isAdmin(): Promise<boolean> {
  const session = await auth()
  return session?.user?.role === 'admin'
}
