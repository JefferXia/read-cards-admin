/**
 * 老卡回填：复习从「只做一遍」切换到自适应排程后，把存量 DONE 卡迁到新语义。
 * 运行：pnpm exec tsx scripts/backfill-srs.ts
 *
 * 规则（2026-11-15 产品确认）：
 * - DONE + tier=2 → 毕业 MASTERED（tier2Count=2：老卡当时那遍已「很巩固」，视作已达两次标准）
 * - DONE + tier=0/1 → 重新入队：按现有 tier 走一遍排程（reps 从 0 起算，
 *   下次到期 = 明天 / 按阶梯），之后与新课同一套 1→3→7→14→30 天周期
 * - NEW 卡不动（本来就在队列里，首次复习到期时间不变）
 * 幂等：只处理 phase=DONE 的行，重复运行无二次影响。
 */
import { PrismaClient } from '@prisma/client'
import { scheduleReview } from '../lib/study'

const prisma = new PrismaClient()

async function main() {
  const doneStates = await prisma.cardState.findMany({
    where: { phase: 'DONE' },
    select: { id: true, tier: true },
  })

  let graduated = 0
  let requeued = 0
  for (const s of doneStates) {
    const tier = (s.tier ?? 1) as 0 | 1 | 2
    const next = scheduleReview(tier, { reps: 0, tier2Count: 0 })
    // tier=2 的老卡 scheduleReview 只会给 tier2Count=1，未达毕业线——
    // 按回填口径直接毕业：这遍复习发生在过去且结论「很巩固」
    const mastered = tier === 2
    await prisma.cardState.update({
      where: { id: s.id },
      data: mastered
        ? { phase: 'MASTERED', tier2Count: 2 }
        : { phase: next.phase, reps: next.reps, tier2Count: next.tier2Count, dueAt: next.dueAt },
    })
    if (mastered) graduated++
    else requeued++
  }
  console.log(`回填完成：毕业 ${graduated} 张，重新入队 ${requeued} 张（共 ${doneStates.length} 张 DONE 卡）`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
