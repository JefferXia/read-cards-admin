/**
 * 种子数据：非公版书《关于如何去爱》（无章节，卡直属书）
 * 数据源：scripts/love-book-data.json（book + 25 cards）
 * 运行：pnpm exec tsx scripts/seed-love-book.ts
 *
 * 说明：
 * - 卡片不绑定章节：chapterId=null、idx=0，归属只看 bookId，排序走 sortOrder（序列自动递增）
 * - 幂等：书按 slug upsert；卡按 bookId+title 定位，更新不改 sortOrder（顺序保持首插顺序）
 * - 沿用「同时只有一本在学」约定：本书 ACTIVE，其它书 ARCHIVED
 *   （在读用户靠 resolveBook 续读旧书，不受影响；新用户/读完用户进入本书）
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()

interface DataCard {
  id: string
  module: string
  name: string
  definition: string
  quote: string
  source: string
  reconstruct: string
  trigger: string
  boundaries: string[]
  level: string
}

interface DataFile {
  book: {
    title: string
    subtitle: string
    author: string
  }
  totalCards: number
  cards: DataCard[]
}

const SLUG = 'how-to-love'

async function main() {
  const file = path.resolve(process.cwd(), 'scripts', 'love-book-data.json')
  const data = JSON.parse(readFileSync(file, 'utf-8')) as DataFile

  const book = await prisma.book.upsert({
    where: { slug: SLUG },
    update: {
      title: data.book.title,
      subtitle: data.book.subtitle,
      author: data.book.author,
      status: 'ACTIVE',
    },
    create: {
      slug: SLUG,
      title: data.book.title,
      subtitle: data.book.subtitle,
      author: data.book.author,
      status: 'ACTIVE',
    },
  })

  // 同时只保留一本在学书（与 seed.ts 约定一致）
  await prisma.book.updateMany({
    where: { status: 'ACTIVE', NOT: { id: book.id } },
    data: { status: 'ARCHIVED' },
  })

  // 卡片：直属书、无章节；幂等 upsert（bookId+title 定位）
  let created = 0
  let updated = 0
  for (const c of data.cards) {
    const fields = {
      module: c.module,
      definition: c.definition,
      quote: c.quote,
      recast: c.reconstruct,
      trigger: c.trigger,
      boundaries: c.boundaries,
      source: c.source,
      status: 'APPROVED' as const,
    }
    const existing = await prisma.card.findFirst({
      where: { bookId: book.id, title: c.name },
      select: { id: true },
    })
    if (existing) {
      await prisma.card.update({ where: { id: existing.id }, data: fields })
      updated++
    } else {
      await prisma.card.create({
        data: { bookId: book.id, chapterId: null, idx: 0, title: c.name, ...fields },
      })
      created++
    }
  }

  const total = await prisma.card.count({ where: { bookId: book.id } })
  console.log(
    '✓ 非公版书入库：book=%s（ACTIVE）, cards=%d（新建 %d / 更新 %d，全 APPROVED，无章节）',
    book.slug,
    total,
    created,
    updated,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
