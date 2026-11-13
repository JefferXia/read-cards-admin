import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { pickBook, pickRandomBook } from '@/lib/bookpick'

export const runtime = 'nodejs'

/**
 * POST /api/study/search { confusion?, excludeId? } —— 搜索书单
 * 有困惑：从书库全部书（不分状态）中选一本最契合的，并给一句推荐理由。
 * 无困惑：随机换一本上架书（尽量避开 excludeId 指向的当前书）。
 * 刷新本身不落库：返回选中的书和推荐理由，用户领取时（POST /api/study/claim
 * 带 book.id）才确认换书并记入书单表 —— UserBook 只收录领取过的书。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    confusion?: string
    excludeId?: string
  }
  const confusion = (body.confusion ?? '').trim().slice(0, 120)

  const pick = confusion ? await pickBook(confusion) : await pickRandomBook(body.excludeId)
  return NextResponse.json(pick)
}
