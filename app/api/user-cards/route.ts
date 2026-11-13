import { NextResponse } from 'next/server'
import type { UserCard } from '@prisma/client'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

/** DB 行 → API 卡片（字段名与 /api/cards/generate 返回对齐：title→name、recast→reconstruct） */
function toApi(r: UserCard) {
  return {
    id: r.id,
    module: r.module,
    name: r.title,
    definition: r.definition,
    quote: r.quote,
    source: r.source,
    reconstruct: r.recast,
    trigger: r.trigger,
    boundaries: r.boundaries,
    sourceTitle: r.sourceTitle,
    sourceAuthor: r.sourceAuthor,
    createdAt: r.createdAt,
  }
}

/** GET /api/user-cards —— 我的自建卡（新→旧，上限 200 条） */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await prisma.userCard.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ cards: rows.map(toApi) })
}

/** DELETE /api/user-cards?id= —— 删除自己的自建卡（不存在的/别人的统一 404） */
export async function DELETE(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const row = await prisma.userCard.findFirst({ where: { id, userId }, select: { id: true } })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await prisma.userCard.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
