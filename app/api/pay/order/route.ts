import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth'
import { buildPayData, newOutTradeNo, payConfigured, payGoodsPrice, payProductId } from '@/lib/wxpay'

export const runtime = 'nodejs'

/**
 * POST /api/pay/order —— 虚拟支付下单（道具直购「会员月卡」）
 * 生成业务单号 outTradeNo + 签名后的 payData，前端拿去 wx.requestVirtualPayment 拉起支付。
 * 发货不依赖本接口：以「发货推送」为主（/api/pay/notify）、query_order 查单兜底（/api/pay/query）。
 */
export async function POST() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!payConfigured()) return NextResponse.json({ error: 'pay_not_configured' }, { status: 503 })

  // sessionKey 是用户态签名的密钥：未登录过（或 dev-login）时没有，需要前端重新 wx.login
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { openId: true, sessionKey: true },
  })
  if (!user?.openId) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  if (!user.sessionKey) {
    return NextResponse.json(
      { error: 'session_expired', hint: '重新 wx.login 刷新 sessionKey 后重试' },
      { status: 409 },
    )
  }

  // attach 透传 userId：发货推送原样带回，极端情况下订单行丢失仍能定位发货人
  const outTradeNo = newOutTradeNo()
  const payData = buildPayData({ outTradeNo, sessionKey: user.sessionKey, attach: userId })

  try {
    await prisma.order.create({
      data: {
        outTradeNo,
        userId,
        productId: payProductId(),
        buyQuantity: 1,
        goodsPrice: payGoodsPrice(),
        attach: userId,
        env: 0,
        status: 'CREATED',
      },
    })
  } catch {
    // 业务单号撞唯一键（概率极低）：换一个单号重试一次
    const retry = newOutTradeNo()
    const retryData = buildPayData({ outTradeNo: retry, sessionKey: user.sessionKey, attach: userId })
    await prisma.order.create({
      data: {
        outTradeNo: retry,
        userId,
        productId: payProductId(),
        buyQuantity: 1,
        goodsPrice: payGoodsPrice(),
        attach: userId,
        env: 0,
        status: 'CREATED',
      },
    })
    return NextResponse.json({ ...retryData, outTradeNo: retry, goodsPrice: payGoodsPrice() })
  }

  return NextResponse.json({ ...payData, outTradeNo, goodsPrice: payGoodsPrice() })
}
