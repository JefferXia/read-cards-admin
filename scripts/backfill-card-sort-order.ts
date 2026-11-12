/**
 * 一次性回填：Card.sortOrder = 数据源 JSON 顺序（1..N）
 * 做法：重放 seed 的映射逻辑（JSON 顺序 → 第N篇章节 → 章内出现序 idx），
 *       定位库中对应卡，按 JSON 全局顺序写 sortOrder；最后把序列拨到 MAX。
 * 运行：pnpm exec tsx scripts/backfill-card-sort-order.ts
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()

interface DataCard {
  id: string
  module: string
  name: string
  source: string
}

interface DataFile {
  book: { title: string }
  cards: DataCard[]
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 「第一篇《立命之学》」→ { idx: 1, title: '立命之学' }（与 seed.ts 一致） */
function chapterOf(source: string): { idx: number; title: string } {
  const num = source.match(/第([一二三四五六七八九十]+)篇/)?.[1] ?? '一'
  const title = source.match(/《(.+?)》/)?.[1] ?? '未分篇'
  return { idx: CN_NUM[num] ?? 1, title }
}

async function main() {
  const file = path.resolve(process.cwd(), 'scripts', 'liaofan-data.json')
  const data = JSON.parse(readFileSync(file, 'utf-8')) as DataFile

  const book = await prisma.book.findFirst({ where: { title: data.book.title } })
  if (!book) throw new Error(`找不到书：${data.book.title}`)
  const chapters = await prisma.chapter.findMany({ where: { bookId: book.id } })
  const chByIdx = new Map(chapters.map((ch) => [ch.idx, ch]))

  // 重放 seed：JSON 顺序 → (chapterId, 章内 idx)
  const perChapter = new Map<number, number>()
  const targets: { key: string; pos: number; label: string }[] = []
  let miss = 0
  data.cards.forEach((c, i) => {
    const { idx: chIdx } = chapterOf(c.source)
    const ch = chByIdx.get(chIdx)
    if (!ch) {
      console.error('✗ 章节 %s 不存在（卡 %s %s）', c.source, c.id, c.name)
      miss++
      return
    }
    const idx = (perChapter.get(chIdx) ?? 0) + 1
    perChapter.set(chIdx, idx)
    targets.push({ key: `${ch.id}|${idx}`, pos: i + 1, label: `${c.id} ${c.module}·${c.name}` })
  })
  if (miss > 0) throw new Error(`${miss} 张卡定位失败，中止`)

  // (chapterId, idx) → 卡
  const keys = targets.map((t) => {
    const [chapterId, idx] = t.key.split('|')
    return { chapterId, idx: Number(idx) }
  })
  const cards = await prisma.card.findMany({
    where: { OR: keys.map((k) => ({ chapterId: k.chapterId, idx: k.idx })) },
    select: { id: true, chapterId: true, idx: true, title: true },
  })
  const byKey = new Map(cards.map((c) => [`${c.chapterId}|${c.idx}`, c]))

  let done = 0
  for (const t of targets) {
    const card = byKey.get(t.key)
    if (!card) {
      console.error('✗ 库中未找到 %s（%s）', t.key, t.label)
      continue
    }
    await prisma.card.update({ where: { id: card.id }, data: { sortOrder: t.pos } })
    console.log('%2d. %s → %s', t.pos, t.label, card.title)
    done++
  }

  // 序列拨到当前最大值，后续新建卡从 MAX+1 继续（ALTER 建列时每行已消费过 nextval，此处对齐兜底）
  const max = await prisma.card.aggregate({ _max: { sortOrder: true } })
  await prisma.$executeRawUnsafe(
    `SELECT setval('"Card_sortOrder_seq"', ${max._max.sortOrder ?? 0})`,
  )
  console.log('✓ 回填 %d/%d 张，序列已拨至 %s', done, targets.length, max._max.sortOrder)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
