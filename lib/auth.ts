import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from './db'

const COOKIE = 'yr_session'
const SECRET = () => process.env.SESSION_SECRET ?? 'dev-secret'
const DAYS = () => Number(process.env.SESSION_DAYS ?? 30)

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET()).update(payload).digest('hex').slice(0, 32)
}

export function issueToken(userId: string): string {
  const exp = Date.now() + DAYS() * 24 * 3600 * 1000
  const payload = `${userId}.${exp}`
  return `${payload}.${sign(payload)}`
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, exp, mac] = parts
  if (Number(exp) < Date.now()) return null
  if (sign(`${userId}.${exp}`) !== mac) return null
  return userId
}

export async function setSessionCookie(userId: string) {
  const jar = await cookies()
  jar.set(COOKIE, issueToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: DAYS() * 24 * 3600,
    path: '/',
  })
}

/** 路由守卫：返回 userId 或 null（由调用方决定 401） */
export async function currentUserId(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  const userId = verifyToken(token)
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  return user?.id ?? null
}

/** 登录建号默认昵称：书友 + 4 位随机数（仅展示，不要求唯一） */
export function randomNickname(): string {
  return `书友${Math.floor(1000 + Math.random() * 9000)}`
}
