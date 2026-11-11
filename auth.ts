import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

import { authConfig } from './auth.config'

/**
 * 运营后台登录：单运营账号（env 配置），Credentials → JWT session。
 * session.user 携带 id 与 role='admin'；API 侧统一用 lib/admin.ts 的 isAdmin() 判断。
 */
export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: 'admin',
      name: '运营后台',
      credentials: {
        username: { label: '账号', type: 'text' },
        password: { label: '口令', type: 'password' },
      },
      async authorize(credentials) {
        const username = process.env.ADMIN_USERNAME ?? 'admin'
        const password = process.env.ADMIN_PASSWORD
        if (!password) return null // 未配置口令一律拒绝
        if (credentials?.username !== username || credentials?.password !== password) return null
        return { id: 'admin', name: '运营', role: 'admin' }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    },
  },
})
