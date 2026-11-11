'use server'

import { AuthError } from 'next-auth'

import { signIn } from '@/auth'

export interface LoginActionState {
  status: 'idle' | 'in_progress' | 'success' | 'failed'
}

/** 管理台登录：server action 调 signIn('admin')，失败时 v5 抛 AuthError（含 CredentialsSignin） */
export async function login(_: LoginActionState, formData: FormData): Promise<LoginActionState> {
  try {
    await signIn('admin', {
      username: String(formData.get('username') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirect: false,
    })
    return { status: 'success' }
  } catch (error) {
    if (error instanceof AuthError) return { status: 'failed' }
    throw error
  }
}
