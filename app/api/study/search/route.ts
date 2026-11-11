import { NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { pickBook } from '@/lib/bookpick'

export const runtime = 'nodejs'

/**
 * POST /api/study/search { confusion } —— 搜索书单
 * 带着困惑从书库全部书（不分状态）中选一本最契合的，并给一句推荐理由。
 * 只做推荐不入库：claim 时仍按「书单连续性」锁书。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { confusion?: string }
  const confusion = (body.confusion ?? '').trim().slice(0, 120)
  if (!confusion) return NextResponse.json({ error: 'confusion required' }, { status: 400 })

  const pick = await pickBook(confusion)
  return NextResponse.json(pick)
}
