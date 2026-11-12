import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

async function guard() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return null
}

/** GET /api/admin/cards —— 全书章节 + 卡片（管理视角） */
export async function GET() {
  const denied = await guard()
  if (denied) return denied

  const books = await prisma.book.findMany({
    orderBy: { slug: 'asc' },
    include: {
      chapters: {
        orderBy: { idx: 'asc' },
        include: { cards: { orderBy: { idx: 'asc' } } },
      },
      cards: { where: { chapterId: null }, orderBy: { sortOrder: 'asc' } }, // 仅直属卡（无章节卡）
    },
  })
  return NextResponse.json({ books })
}

/** POST /api/admin/cards —— 新建卡片（草稿）；挂载点二选一：chapterId（章节卡）或 bookId（直属卡） */
export async function POST(req: Request) {
  const denied = await guard()
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as {
    bookId?: string
    chapterId?: string
    module?: string
    title?: string
    definition?: string
    quote?: string
    recast?: string
    trigger?: string
    boundaries?: string[]
    source?: string
  } | null
  if (
    !body ||
    !(body.chapterId || body.bookId) ||
    (body.chapterId && body.bookId) ||
    !body.title?.trim() ||
    !body.definition?.trim() ||
    !body.trigger?.trim()
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  let bookId: string
  let chapterId: string | null = null
  let idx = 0 // 直属卡无章节内序（唯一键中 NULL 互不冲突）
  if (body.chapterId) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: body.chapterId },
      select: { bookId: true },
    })
    if (!chapter) return NextResponse.json({ error: 'chapter_not_found' }, { status: 400 })
    bookId = chapter.bookId
    chapterId = body.chapterId
    const last = await prisma.card.findFirst({
      where: { chapterId: body.chapterId },
      orderBy: { idx: 'desc' },
      select: { idx: true },
    })
    idx = (last?.idx ?? 0) + 1
  } else {
    const book = await prisma.book.findUnique({
      where: { id: body.bookId! },
      select: { id: true },
    })
    if (!book) return NextResponse.json({ error: 'book_not_found' }, { status: 400 })
    bookId = book.id
  }

  const card = await prisma.card.create({
    data: {
      bookId, // 卡直属书（章节卡冗余自章节，直属卡为唯一归属）
      chapterId,
      idx,
      module: body.module?.trim() ?? '',
      title: body.title.trim(),
      definition: body.definition.trim(),
      quote: body.quote?.trim() ?? '',
      recast: body.recast?.trim() ?? '',
      trigger: body.trigger.trim(),
      boundaries: (body.boundaries ?? []).map((s) => s.trim()).filter(Boolean),
      source: body.source?.trim() ?? '',
      status: 'DRAFT',
    },
  })
  return NextResponse.json({ card })
}

/** PATCH /api/admin/cards —— 更新卡片（含审核状态流转） */
export async function PATCH(req: Request) {
  const denied = await guard()
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as {
    id?: string
    module?: string
    title?: string
    definition?: string
    quote?: string
    recast?: string
    trigger?: string
    boundaries?: string[]
    source?: string
    status?: 'DRAFT' | 'APPROVED'
  } | null
  if (!body?.id) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (body.module !== undefined) data.module = body.module.trim()
  if (body.title !== undefined) data.title = body.title.trim()
  if (body.definition !== undefined) data.definition = body.definition.trim()
  if (body.quote !== undefined) data.quote = body.quote.trim()
  if (body.recast !== undefined) data.recast = body.recast.trim()
  if (body.trigger !== undefined) data.trigger = body.trigger.trim()
  if (body.boundaries !== undefined)
    data.boundaries = body.boundaries.map((s) => s.trim()).filter(Boolean)
  if (body.source !== undefined) data.source = body.source.trim()
  if (body.status !== undefined) data.status = body.status

  const card = await prisma.card.update({ where: { id: body.id }, data })
  return NextResponse.json({ card })
}

/** DELETE /api/admin/cards?id= —— 删除草稿卡（已上架的先撤回） */
export async function DELETE(req: Request) {
  const denied = await guard()
  if (denied) return denied

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const states = await prisma.cardState.count({ where: { cardId: id } })
  if (states > 0) {
    return NextResponse.json({ error: 'card_in_use' }, { status: 409 })
  }
  await prisma.card.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
