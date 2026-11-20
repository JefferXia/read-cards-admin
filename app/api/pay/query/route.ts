import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { deliverOrder, payConfigured, queryOrder } from '@/lib/wxpay'

export const runtime = 'nodejs'

/**
 * POST /api/pay/query —— 兜底查单（转发 /xpay/query_order）
 * 发货推送丢失时主动查单：查到已支付（order_status=2）就补发货。
 * 请求体 { outTradeNo }；只允许查本人的订单。
 */
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!payConfigured()) return NextResponse.json({ error: 'pay_not_configured' }, { status: 503 })

  const body = (await req.json().catch(() => ({}))) as { outTradeNo?: string }
  if (!body.outTradeNo) return NextResponse.json({ error: 'missing outTradeNo' }, { status: 400 })

  const order = await prisma.order.findFirst({
    where: { outTradeNo: body.outTradeNo, userId },
  })
  if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 })
  if (order.status === 'DELIVERED') return NextResponse.json({ status: 'DELIVERED' })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { openId: true } })
  if (!user?.openId) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  const res = await queryOrder(user.openId, order.outTradeNo)
  if (!res) return NextResponse.json({ error: 'query_failed' }, { status: 502 })

  if (res.paid) {
    if (!order.wxOrderId && res.wxOrderId) {
      await prisma.order.update({ where: { id: order.id }, data: { wxOrderId: res.wxOrderId } })
    }
    await deliverOrder(order.id, res.wxOrderId) // 幂等：已发货则跳过
    return NextResponse.json({ status: 'DELIVERED' })
  }
  return NextResponse.json({ status: 'UNPAID', platformStatus: res.rawStatus })
}
