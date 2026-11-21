/**
 * 存量用户一次性回填初始积分：SubscribeCredit 行缺失的用户建行（每人 +30）。
 * 幂等：已有余额行的用户不重复发放（skipDuplicates + 只查缺行的用户），可安全重跑。
 * （新用户建号时 wx-login 已自动赠送，本脚本只为存量用户补齐）
 *
 * 用法：cd /Users/xia/ai/yinian-read-web && node --env-file=.env scripts/credit-backfill.mjs
 */
import { PrismaClient } from '@prisma/client'

const INITIAL_CREDITS = 30
const prisma = new PrismaClient()

async function main() {
  // 只找还没有余额行的用户（绝不碰已发放/已扣减过的余额）
  const users = await prisma.user.findMany({
    where: { subscribeCredits: null },
    select: { id: true },
  })
  console.log(`待回填用户 ${users.length} 名（每人 +${INITIAL_CREDITS} 积分）`)

  const res = await prisma.subscribeCredit.createMany({
    data: users.map((u) => ({ userId: u.id, credits: INITIAL_CREDITS })),
    skipDuplicates: true,
  })
  console.log(`已回填 ${res.count} 名`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
