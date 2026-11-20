import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/db'
import { deliverMembership, deliverOrder, payGoodsPrice, payProductId, xmlGet } from '@/lib/wxpay'

export const runtime = 'nodejs'

/** 发货推送回调应答：ErrCode 0 = 成功，非 0 平台会重试（最多 15 次） */
const okXml = '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>'
const failXml = '<xml><ErrCode>-1</ErrCode><ErrMsg><![CDATA[fail]]></ErrMsg></xml>'

/** MP 后台消息推送 Token（发货推送 URL 验签；未配置则跳过校验） */
function pushToken(): string {
  return process.env.WX_PUSH_TOKEN ?? ''
}

/** 标准微信推送验签：sha1(sort(token, timestamp, nonce).join('')) */
function verifyPushSig(url: URL): boolean {
  const token = pushToken()
  if (!token) return true
  const signature = url.searchParams.get('signature') ?? ''
  const timestamp = url.searchParams.get('timestamp') ?? ''
  const nonce = url.searchParams.get('nonce') ?? ''
  if (!signature || !timestamp || !nonce) return false
  const expect = crypto
    .createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex')
  return expect === signature
}

/** 消息推送 URL 配置时的 GET 校验（原样回显 echostr） */
export async function GET(req: Request) {
  const url = new URL(req.url)
  if (!verifyPushSig(url)) return new NextResponse('bad signature', { status: 403 })
  return new NextResponse(url.searchParams.get('echostr') ?? 'ok')
}

/**
 * POST /api/pay/notify —— 平台发货推送（xpay_goods_deliver_notify）
 * MP 后台【消息推送】配置本 URL；支付成功后平台 POST XML 到这里。
 * 幂等以本地订单 status（≠ DELIVERED 才发货）+ 平台单号 wxOrderId 为准。
 */
export async function POST(req: Request) {
  const url = new URL(req.url)
  if (!verifyPushSig(url)) return new NextResponse(failXml, { status: 403 })

  const xml = await req.text()
  const event = xmlGet(xml, 'Event')
  const outTradeNo = xmlGet(xml, 'OutTradeNo')
  const wxOrderId = xmlGet(xml, 'MchOrderNo') // 平台单号 wx_order_id
  const openId = xmlGet(xml, 'OpenId')
  const productId = xmlGet(xml, 'ProductId')
  if (event !== 'xpay_goods_deliver_notify' || !outTradeNo || !wxOrderId) {
    return new NextResponse(failXml, { status: 400 })
  }

  // 本地订单行优先（常规路径）：按业务单号找到订单，幂等发货
  const order = await prisma.order.findUnique({ where: { outTradeNo } })
  if (order) {
    if (order.wxOrderId && order.wxOrderId !== wxOrderId) {
      // 单号对不上：异常推送，拒绝（平台会重试）
      return new NextResponse(failXml, { status: 400 })
    }
    if (!order.wxOrderId) {
      await prisma.order.update({ where: { id: order.id }, data: { wxOrderId } })
    }
    await deliverOrder(order.id, wxOrderId)
    return new NextResponse(okXml)
  }

  // 兜底路径（订单行缺失，如查单补发前的极端场景）：attach / OpenId 定位用户直接发货
  let userId = xmlGet(xml, 'Attach') ?? undefined
  if (!userId && openId) {
    const u = await prisma.user.findUnique({ where: { openId }, select: { id: true } })
    userId = u?.id
  }
  if (!userId) return new NextResponse(failXml, { status: 400 })

  // 落一行已发货订单（以 wxOrderId 幂等去重；撞唯一键说明已发过，直接成功）
  try {
    await prisma.order.create({
      data: {
        outTradeNo,
        wxOrderId,
        userId,
        productId: productId ?? payProductId(),
        buyQuantity: 1,
        goodsPrice: payGoodsPrice(),
        env: 0,
        status: 'DELIVERED',
        paidAt: new Date(),
        deliveredAt: new Date(),
      },
    })
  } catch {
    return new NextResponse(okXml)
  }
  if (productId === payProductId() || !productId) await deliverMembership(userId)
  return new NextResponse(okXml)
}
