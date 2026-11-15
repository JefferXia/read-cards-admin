import { NextResponse } from 'next/server'
import type { UserCard } from '@prisma/client'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

/** DB 行 → API 卡片（module + 卡名 + 重构阐释 + 原文整段，按 sourceTitle 聚合卡包） */
function toApi(r: UserCard) {
  return {
    id: r.id,
    module: r.module,
    title: r.title,
    recast: r.recast,
    quote: r.quote,
    sourceTitle: r.sourceTitle,
    sourceAuthor: r.sourceAuthor,
    createdAt: r.createdAt,
  }
}

/** GET /api/user-cards —— 我的认知卡（新→旧，上限 200 条） */
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

/**
 * DELETE /api/user-cards?id= —— 删除自己的单张认知卡
 * DELETE /api/user-cards?title= —— 删除整个自建卡包（按书名/标题批量删卡，连带复习状态级联删除）
 * 不存在的/别人的统一 404
 */
export async function DELETE(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  const title = url.searchParams.get('title') ?? ''

  if (id) {
    const row = await prisma.userCard.findFirst({ where: { id, userId }, select: { id: true } })
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await prisma.userCard.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  }

  if (title) {
    const r = await prisma.userCard.deleteMany({ where: { userId, sourceTitle: title } })
    if (r.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true, count: r.count })
  }

  return NextResponse.json({ error: 'id_required' }, { status: 400 })
}
