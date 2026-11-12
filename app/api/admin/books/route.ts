import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

async function guard() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return null
}

/** PATCH /api/admin/books —— 编辑书状态（ACTIVE 全局唯一，切换时自动归档其它在学书） */
export async function PATCH(req: Request) {
  const denied = await guard()
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as {
    id?: string
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  } | null
  if (!body?.id || !body.status) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const book = await prisma.book.findUnique({ where: { id: body.id }, select: { id: true } })
  if (!book) return NextResponse.json({ error: 'book_not_found' }, { status: 400 })

  const updated = await prisma.$transaction(async (tx) => {
    if (body.status === 'ACTIVE') {
      // 「同时只有一本在学」：resolveBook 的新用户默认书走 findFirst ACTIVE，多本会不确定
      await tx.book.updateMany({
        where: { status: 'ACTIVE', NOT: { id: body.id } },
        data: { status: 'ARCHIVED' },
      })
    }
    return tx.book.update({ where: { id: body.id }, data: { status: body.status! } })
  })

  return NextResponse.json({ book: updated })
}
