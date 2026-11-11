import { redirect } from 'next/navigation'

import { auth } from '@/auth'

import AdminConsole from './console'

/** 页面级判权（middleware 已拦一道，这里兜底并透出操作者名） */
export default async function AdminPage() {
  const session = await auth()
  if (!session?.user) redirect('/admin/login')
  return <AdminConsole operator={session.user.name ?? '运营'} />
}
