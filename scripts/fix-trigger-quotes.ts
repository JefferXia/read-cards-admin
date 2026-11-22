/**
 * 一次性脚本：将 Card.trigger 中的 {LQ}/{RQ} 占位符替换为中文双引号 “ ”。
 * 用法：pnpm tsx scripts/fix-trigger-quotes.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const before = await prisma.card.findMany({
    where: { OR: [{ trigger: { contains: '{LQ}' } }, { trigger: { contains: '{RQ}' } }] },
    select: { id: true, trigger: true },
  })
  console.log(`受影响卡片：${before.length} 张`)
  for (const c of before.slice(0, 5)) console.log(`  修改前: ${c.trigger}`)

  const count = await prisma.$executeRaw`
    UPDATE "Card"
    SET "trigger" = replace(replace("trigger", '{LQ}', '“'), '{RQ}', '”')
    WHERE "trigger" LIKE '%{LQ}%' OR "trigger" LIKE '%{RQ}%'
  `
  console.log(`✓ 已替换 ${count} 张卡的 trigger 引号`)

  const after = await prisma.$queryRaw<{ trigger: string }[]>`
    SELECT "trigger" FROM "Card" WHERE "trigger" LIKE '%{LQ}%' OR "trigger" LIKE '%{RQ}%' LIMIT 5
  `
  console.log(`残留 {LQ}/{RQ} 的卡片：${after.length} 张`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
