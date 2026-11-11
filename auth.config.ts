import type { NextAuthConfig } from 'next-auth'

/**
 * 管理台鉴权 —— edge-safe 共享配置（middleware 与 auth.ts 共用）。
 * providers 在 auth.ts 中补充（可能含 Node 依赖，不进 edge）。
 */
export const authConfig = {
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: '/admin/login',
  },
  // edge-safe 配置不放 providers（Node 依赖的部分在 auth.ts 中补充）
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const onAdmin = nextUrl.pathname.startsWith('/admin')
      const onLogin = nextUrl.pathname.startsWith('/admin/login')

      if (!onAdmin) return true
      if (onLogin) {
        if (isLoggedIn) return Response.redirect(new URL('/admin', nextUrl))
        return true
      }
      // 未登录访问后台 → v5 会重定向到 pages.signIn（/admin/login）
      return isLoggedIn
    },
  },
} satisfies NextAuthConfig
