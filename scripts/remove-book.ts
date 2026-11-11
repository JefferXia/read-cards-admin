/**
 * 删除一本书及其全部章节数据（含学习记录）。
 * 用法：pnpm tsx scripts/remove-book.ts <slug>
 * 顺序：CardState → Card → Chapter → Book（外键约束从叶子到根）。
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const slug = process.argv[2]
if (!slug) throw new Error('用法：pnpm tsx scripts/remove-book.ts <slug>')

async function main() {
  const book = await prisma.book.findUnique({
    where: { slug },
    include: { chapters: { select: { id: true } } },
  })
  if (!book) {
    console.log(`书 ${slug} 不存在，无事可做`)
    return
  }

  const chapterIds = book.chapters.map((c) => c.id)
  const cards = await prisma.card.findMany({
    where: { chapterId: { in: chapterIds } },
    select: { id: true },
  })
  const cardIds = cards.map((c) => c.id)

  const states = await prisma.cardState.deleteMany({ where: { cardId: { in: cardIds } } })
  const delCards = await prisma.card.deleteMany({ where: { id: { in: cardIds } } })
  const delChapters = await prisma.chapter.deleteMany({ where: { id: { in: chapterIds } } })
  await prisma.book.delete({ where: { id: book.id } })

  console.log(
    `✓ 已删除《${book.title}》（${slug}）：学习记录 ${states.count} 条、卡片 ${delCards.count} 张、章节 ${delChapters.count} 个`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
