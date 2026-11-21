/**
 * 订阅积分（SubscribeCredit）：自建认知卡的用量闸门
 * - 建号赠送 INITIAL_CREDITS（30）＝ 非会员最多 3 次生成（30 ÷ 10）
 * - 每次 AI 生成认知卡扣 CARD_COST（10），生成失败退款
 * - 会员月卡发货自动充值 MEMBER_CREDITS（1000）＝ 会员结算补给
 * 所有操作幂等/原子：发放靠 userId @unique 不重复，扣减用条件更新防并发透支。
 */
import { prisma } from './db'

/** 初始赠送积分（建号 & 存量回填） */
export const INITIAL_CREDITS = 30
/** 每次生成认知卡扣积分 */
export const CARD_COST = 10
/** 会员月卡发货自动充值积分 */
export const MEMBER_CREDITS = 1000

/** 确保有余额行：缺失则按初始赠送建行（存量用户未回填时惰性补齐），返回当前余额 */
export async function ensureCredits(userId: string): Promise<number> {
  const row = await prisma.subscribeCredit.upsert({
    where: { userId },
    update: {},
    create: { userId, credits: INITIAL_CREDITS },
  })
  return row.credits
}

/** 充值/发放积分：余额行缺失则按充值额建行（会员月卡发货用） */
export async function addCredits(userId: string, amount: number): Promise<void> {
  await prisma.subscribeCredit.upsert({
    where: { userId },
    update: { credits: { increment: amount } },
    create: { userId, credits: amount },
  })
}

/** 余额充足时原子扣减（防并发透支）；返回 false = 余额不足 */
export async function deductCredits(userId: string, cost: number): Promise<boolean> {
  const res = await prisma.subscribeCredit.updateMany({
    where: { userId, credits: { gte: cost } },
    data: { credits: { decrement: cost } },
  })
  return res.count > 0
}

/** 扣减后退款（生成失败回补） */
export async function refundCredits(userId: string, cost: number): Promise<void> {
  await prisma.subscribeCredit.updateMany({
    where: { userId },
    data: { credits: { increment: cost } },
  })
}
