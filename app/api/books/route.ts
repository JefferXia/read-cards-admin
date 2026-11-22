import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { getOrSet } from '@/lib/cache'

export const runtime = 'nodejs'

/**
 * GET /api/books —— 全部在架书（发现卡页数据源）
 * 返回除 DRAFT 外的所有书（ACTIVE / ARCHIVED）+ 本书 APPROVED 卡数（卡包右上角展示）。
 * 会话自检不拦截：书列表本身公开。
 * 数据全局一致且不常变：LRU 缓存 5 分钟，admin 写操作后失效。
 */
export async function GET() {
  const data = await getOrSet('books:list', 5 * 60_000, async () => {
    const [books, counts] = await Promise.all([
      prisma.book.findMany({
        where: { status: { not: 'DRAFT' } },
        // sortOrder 由 admin 书单维护；0 = 未指定，按书名兜底
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          title: true,
          subtitle: true,
          author: true,
          tagline: true,
        },
      }),
      // 各书 APPROVED 卡数（一次分组统计，避免逐书 count 的 N+1）
      prisma.card.groupBy({ by: ['bookId'], where: { status: 'APPROVED' }, _count: { _all: true } }),
    ])
    const countMap = new Map(counts.map((c) => [c.bookId, c._count._all]))
    return books.map((b) => ({
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      author: b.author,
      tagline: b.tagline,
      cardCount: countMap.get(b.id) ?? 0,
    }))
  })
  void (await currentUserId())

  return NextResponse.json(data)
}
