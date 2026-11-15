import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * 我的卡包（书）：领取/导入过的书（UserBook）
 *
 * GET    /api/user-books        —— 卡包列表（含书信息 + 全书 APPROVED 卡数）
 * POST   /api/user-books        —— { bookId } 导入（发现卡组「加入卡包」；重复导入幂等）
 * DELETE /api/user-books?id=    —— 从我的卡包移除（不存在的/别人的统一 404）
 *
 * 卡包数据源：UserBook（导入/领取过的书）+ UserCard（自建卡），见 GET /api/user-cards
 */
function toApi(
  r: {
    id: string
    bookId: string
    createdAt: Date
    book: { id: string; title: string; subtitle: string | null; author: string; tagline: string | null }
  },
  cardCount: number,
) {
  return {
    /** userBook 主键（移除用） */
    id: r.id,
    bookId: r.bookId,
    title: r.book.title,
    subtitle: r.book.subtitle ?? '',
    author: r.book.author,
    /** 一句话推荐语（卡包定义行） */
    tagline: r.book.tagline ?? '',
    /** 全书 APPROVED 卡数（卡包左上角总卡数） */
    cardCount,
    addedAt: r.createdAt.toISOString(),
  }
}

export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await prisma.userBook.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      book: { select: { id: true, title: true, subtitle: true, author: true, tagline: true } },
    },
  })
  // 全书 APPROVED 卡数（一次 groupBy，避免 N+1）
  const bookIds = rows.map((r) => r.bookId)
  const counts = bookIds.length
    ? await prisma.card.groupBy({
        by: ['bookId'],
        where: { bookId: { in: bookIds }, status: 'APPROVED' },
        _count: true,
      })
    : []
  const countMap = new Map(counts.map((c) => [c.bookId, c._count]))

  return NextResponse.json({ books: rows.map((r) => toApi(r, countMap.get(r.bookId) ?? 0)) })
}

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { bookId?: string }
  const bookId = typeof body.bookId === 'string' ? body.bookId : ''
  if (!bookId) return NextResponse.json({ error: 'book_required' }, { status: 400 })

  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } })
  if (!book) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const existing = await prisma.userBook.findUnique({
    where: { userId_bookId: { userId, bookId } },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ ok: true, already: true })

  await prisma.userBook.create({ data: { userId, bookId } })
  return NextResponse.json({ ok: true, already: false })
}

export async function DELETE(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const row = await prisma.userBook.findFirst({ where: { id, userId }, select: { id: true } })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await prisma.userBook.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
