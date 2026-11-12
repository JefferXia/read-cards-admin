import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { resolveBook, bookDeck } from '@/lib/study'

export const runtime = 'nodejs'

/** GET /api/study/deck —— 本书全部卡组（按技能分类编号），含已学标记；书本详情页用 */
export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const book = await resolveBook(userId)
  if (!book) {
    return NextResponse.json({ book: null, modules: [], total: 0, learnedCount: 0, cards: [] })
  }

  const deck = await bookDeck(userId, book.id)
  return NextResponse.json({
    book: { id: book.id, title: book.title, author: book.author },
    modules: deck.modules,
    total: deck.cards.length,
    learnedCount: deck.learnedCount,
    cards: deck.cards,
  })
}
