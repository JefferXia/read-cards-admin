/**
 * 种子数据：《了凡四训》全量卡片（APPROVED）
 * 数据源：scripts/liaofan-data.json（book + cards，四篇 → 四个章节）
 * 运行：pnpm seed （或 pnpm exec tsx scripts/seed.ts）
 *
 * 说明：卡片字段为 SQ3R 结构（卡名/定义/原文/重构/触发问句/边界/出处）。
 * 幂等：书/章/卡均按唯一键 upsert；重复运行只更新不重复建。
 * 切换书目：本 seed 会把其它 ACTIVE 书置为 ARCHIVED，保证同时只有一本在学。
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
    originalTitle: string
    author: string
    year: string
    genre: string
    structure: string
  }
  cards: DataCard[]
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 「第一篇《立命之学》」→ { idx: 1, title: '立命之学' } */
function chapterOf(source: string): { idx: number; title: string } {
  const num = source.match(/第([一二三四五六七八九十]+)篇/)?.[1] ?? '一'
  const title = source.match(/《(.+?)》/)?.[1] ?? '未分篇'
  return { idx: CN_NUM[num] ?? 1, title }
}

async function main() {
  const file = path.resolve(process.cwd(), 'scripts', 'liaofan-data.json')
  const data = JSON.parse(readFileSync(file, 'utf-8')) as DataFile

  const book = await prisma.book.upsert({
    where: { slug: 'liao-fan-si-xun' },
    update: {
      title: data.book.title,
      subtitle: data.book.subtitle,
      author: data.book.author,
      tagline: '命由我作，福自己求。',
      status: 'ACTIVE',
    },
    create: {
      slug: 'liao-fan-si-xun',
      title: data.book.title,
      subtitle: data.book.subtitle,
      author: data.book.author,
      tagline: '命由我作，福自己求。',
      status: 'ACTIVE',
    },
  })

  // 同时只保留一本在学书
  await prisma.book.updateMany({
    where: { status: 'ACTIVE', NOT: { id: book.id } },
    data: { status: 'ARCHIVED' },
  })

  // 章节按出处「第N篇」归组，保持 JSON 内出现顺序
  const chapters = new Map<number, { id: string; title: string }>()
  for (const c of data.cards) {
    const { idx, title } = chapterOf(c.source)
    if (chapters.has(idx)) continue
    const ch = await prisma.chapter.upsert({
      where: { bookId_idx: { bookId: book.id, idx } },
      update: { title },
      create: { bookId: book.id, idx, title },
    })
    chapters.set(idx, { id: ch.id, title })
  }

  // 卡片：章内顺序即 JSON 出现顺序；幂等 upsert
  const perChapter = new Map<number, number>()
  let created = 0
  for (const c of data.cards) {
    const { idx: chIdx } = chapterOf(c.source)
    const ch = chapters.get(chIdx)!
    const idx = (perChapter.get(chIdx) ?? 0) + 1
    perChapter.set(chIdx, idx)

    await prisma.card.upsert({
      where: { chapterId_idx: { chapterId: ch.id, idx } },
      update: {
        title: c.name,
        module: c.module,
        definition: c.definition,
        quote: c.quote,
        recast: c.reconstruct,
        trigger: c.trigger,
        boundaries: c.boundaries,
        source: c.source,
        status: 'APPROVED',
      },
      create: {
        chapterId: ch.id,
        idx,
        title: c.name,
        module: c.module,
        definition: c.definition,
        quote: c.quote,
        recast: c.reconstruct,
        trigger: c.trigger,
        boundaries: c.boundaries,
        source: c.source,
        status: 'APPROVED',
      },
    })
    created++
  }

  console.log(
    '✓ 种子完成：book=%s, chapters=%d, cards=%d（全部 APPROVED）',
    book.slug,
    chapters.size,
    created,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
