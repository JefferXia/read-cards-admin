import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/admin'
import { getOrSet, invalidateBookCaches } from '@/lib/cache'

export const runtime = 'nodejs'

async function guard() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return null
}

/** GET /api/admin/books —— 书单（轻量：仅计数，不嵌卡内容；配合 /api/admin/cards?bookId= 两级加载） */
export async function GET() {
  const denied = await guard()
  if (denied) return denied

  const data = await getOrSet('admin:books', 5 * 60_000, async () => {
    const [books, approved] = await Promise.all([
      prisma.book.findMany({
        // 与发现页一致：sortOrder 在前（0 = 未指定），书名兜底
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          slug: true,
          title: true,
          subtitle: true,
          author: true,
          status: true,
          sortOrder: true,
          _count: { select: { chapters: true, cards: true } },
        },
      }),
      prisma.card.groupBy({ by: ['bookId'], where: { status: 'APPROVED' }, _count: { _all: true } }),
    ])
    const approvedMap = new Map(approved.map((g) => [g.bookId, g._count._all]))
    return {
      books: books.map((b) => ({
        id: b.id,
        slug: b.slug,
        title: b.title,
        subtitle: b.subtitle,
        author: b.author,
        status: b.status,
        sortOrder: b.sortOrder,
        chapterCount: b._count.chapters,
        cardCount: b._count.cards,
        approvedCount: approvedMap.get(b.id) ?? 0,
      })),
    }
  })
  return NextResponse.json(data)
}

/** PATCH /api/admin/books —— 编辑书状态（ACTIVE 全局唯一，切换时自动归档其它在学书）或批量调整发现页排序 */
export async function PATCH(req: Request) {
  const denied = await guard()
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as {
    id?: string
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
    orders?: { id: string; sortOrder: number }[]
  } | null

  // 批量排序：客户端按目标顺序全量重编号（1..N），事务内一次写入
  if (body?.orders) {
    const orders = body.orders
    if (
      !Array.isArray(orders) ||
      orders.length === 0 ||
      orders.some((o) => !o?.id || !Number.isInteger(o.sortOrder))
    ) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    }
    await prisma.$transaction(
      orders.map((o) => prisma.book.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder }, select: { id: true } })),
    )
    invalidateBookCaches()
    return NextResponse.json({ ok: true })
  }

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
  invalidateBookCaches()

  return NextResponse.json({ book: updated })
}
