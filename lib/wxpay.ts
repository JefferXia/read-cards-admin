/**
 * 微信小程序虚拟支付（个人主体，道具直购）服务端封装。
 * 官方接入指引：virtual-payment/person（签名算法见 5.5 节）
 *
 * 两套签名（均为 HMAC-SHA256）：
 *  - paySig：密钥 AppKey（XPAY_APPKEY），msg = uri + '&' + post_body
 *    - C 端下单：uri 固定 requestVirtualPayment
 *    - B 端 /xpay/* 接口：uri 为实际接口路径（如 /xpay/query_order）
 *  - signature（用户态签名）：密钥 sessionKey（auth.code2Session 获取，重新登录刷新），
 *    msg = signData（与传给前端拉起支付时完全一致的 JSON 字符串）
 *
 * 环境变量（MP 后台 → 支付与交易 → 虚拟支付 → 基本配置）：
 *  - XPAY_OFFER_ID      支付商户号 OfferID
 *  - XPAY_APPKEY        现网 AppKey（支付密钥）
 *  - XPAY_PRODUCT_ID    道具 ID（【道具管理】创建的「会员月卡」）
 *  - XPAY_GOODS_PRICE   道具单价（分），必须与后台道具价格一致
 *  - WX_PUSH_TOKEN      （可选）消息推送 Token，用于发货推送 URL 验签
 */
import crypto from 'node:crypto'
import { prisma } from './db'
import { MEMBER_CREDITS, addCredits } from './credits'

const DAY_MS = 24 * 60 * 60 * 1000
/** 会员月卡时长（天） */
export const MEMBERSHIP_DAYS = 30

export function payOfferId(): string {
  return process.env.XPAY_OFFER_ID ?? ''
}
export function payProductId(): string {
  return process.env.XPAY_PRODUCT_ID ?? ''
}
export function payGoodsPrice(): number {
  return Number(process.env.XPAY_GOODS_PRICE ?? 0)
}
/** 支付是否已配置（四项齐全才能下单） */
export function payConfigured(): boolean {
  return Boolean(
    process.env.XPAY_OFFER_ID && process.env.XPAY_APPKEY && payProductId() && payGoodsPrice() > 0,
  )
}

function appKey(): string {
  return process.env.XPAY_APPKEY ?? ''
}

/** 支付签名 paySig：uri 不带问号参数；post_body 必须与实际请求体完全一致（不格式化、不改键序） */
export function calcPaySig(uri: string, postBody: string): string {
  return crypto.createHmac('sha256', appKey()).update(`${uri}&${postBody}`).digest('hex')
}

/** 用户态签名 signature：密钥 sessionKey，msg 为 signData 原文 */
export function calcSignature(postBody: string, sessionKey: string): string {
  return crypto.createHmac('sha256', sessionKey).update(postBody).digest('hex')
}

/** 业务单号：T + 时间戳 + 4 位随机（18 位，8-32 位之间，字母开头不以 _ 开头，唯一） */
export function newOutTradeNo(): string {
  return `T${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`
}

/**
 * 构造前端 wx.requestVirtualPayment 需要的 payData。
 * signData 为紧凑 JSON 字符串，键序固定（offerId/buyQuantity/env/currencyType/productId/
 * goodsPrice/outTradeNo/attach）——签名后任何改动都会导致验签失败。
 */
export function buildPayData(opts: {
  outTradeNo: string
  sessionKey: string
  productId?: string
  goodsPrice?: number
  buyQuantity?: number
  attach?: string
}) {
  const signData =
    `{"offerId":"${payOfferId()}","buyQuantity":${opts.buyQuantity ?? 1},"env":0,` +
    `"currencyType":"CNY","productId":"${opts.productId ?? payProductId()}",` +
    `"goodsPrice":${opts.goodsPrice ?? payGoodsPrice()},` +
    `"outTradeNo":"${opts.outTradeNo}","attach":"${opts.attach ?? ''}"}`
  return {
    mode: 'short_series_goods' as const, // 道具直购
    signData, // JSON 字符串（前端原样传给 wx.requestVirtualPayment）
    paySig: calcPaySig('requestVirtualPayment', signData), // AppKey 签名
    signature: calcSignature(signData, opts.sessionKey), // 用户态签名（sessionKey）
  }
}

/* ---------------- 发货 ---------------- */

/** 会员月卡发货：到期时间从 max(现在, 现有到期) 起顺延 30 天 */
export async function deliverMembership(userId: string): Promise<Date> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { membershipExpiresAt: true },
  })
  const base = user?.membershipExpiresAt && user.membershipExpiresAt > new Date()
    ? user.membershipExpiresAt
    : new Date()
  const expiresAt = new Date(base.getTime() + MEMBERSHIP_DAYS * DAY_MS)
  await prisma.user.update({ where: { id: userId }, data: { membershipExpiresAt: expiresAt } })
  // 充值积分：会员月卡发货自动 +1000（本函数只在真正发货路径调用一次，幂等性由 deliverOrder 条件更新保证）
  await addCredits(userId, MEMBER_CREDITS)
  return expiresAt
}

/**
 * 幂等发货：以本地订单表 status 为准，条件更新（status ≠ DELIVERED 才生效），
 * 同一订单重复通知/查单只发一次货。返回 true 表示本次真正发货。
 */
export async function deliverOrder(orderId: string, wxOrderId?: string): Promise<boolean> {
  const now = new Date()
  const res = await prisma.order.updateMany({
    where: { id: orderId, status: { not: 'DELIVERED' } },
    data: {
      status: 'DELIVERED',
      paidAt: now,
      deliveredAt: now,
      ...(wxOrderId ? { wxOrderId } : {}),
    },
  })
  if (res.count === 0) return false // 已发过货（幂等）
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) return false
  // 目前只有「会员月卡」一个道具；将来多道具按 order.productId 分发
  if (order.productId === payProductId()) {
    await deliverMembership(order.userId)
  }
  return true
}

/* ---------------- 兜底查单（query_order） ---------------- */

export interface QueryOrderResult {
  paid: boolean
  wxOrderId?: string
  /** 平台订单状态（原样透出便于排查） */
  rawStatus?: number
}

/**
 * POST /xpay/query_order（推送丢失时补发货用）。
 * 请求体 { openid, env, order_id: outTradeNo }；pay_sig 以 /xpay/query_order 计算、放 query 参数。
 * 响应 order.order_status：2 = 支付成功（1 待支付，≥3 已关闭/退款等）。
 */
export async function queryOrder(openid: string, outTradeNo: string): Promise<QueryOrderResult | null> {
  const token = await wxAccessToken()
  if (!token) return null
  const body = JSON.stringify({ openid, env: 0, order_id: outTradeNo })
  const paySig = calcPaySig('/xpay/query_order', body)
  try {
    const res = await fetch(
      `https://api.weixin.qq.com/xpay/query_order?access_token=${encodeURIComponent(token)}` +
        `&pay_sig=${encodeURIComponent(paySig)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    )
    const data = (await res.json()) as {
      errcode?: number
      order?: { order_status?: number; order_id?: string }
    }
    if (data.errcode !== 0 || !data.order) return null
    return {
      paid: data.order.order_status === 2,
      wxOrderId: data.order.order_id,
      rawStatus: data.order.order_status,
    }
  } catch {
    return null
  }
}

let tokenCache: { token: string; exp: number } | null = null
export async function wxAccessToken(): Promise<string | null> {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) return null
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`,
  )
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) return null
  tokenCache = { token: data.access_token, exp: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000 }
  return tokenCache.token
}

/* ---------------- 发货推送 XML 解析 ---------------- */

/** 取 XML 中第一个标签的文本（CDATA 兼容） */
export function xmlGet(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))
  return m ? m[1] : null
}
