/**
 * 通用单书导入脚本
 * 用法：pnpm exec tsx scripts/import-book.ts <book_data.json> [选项]
 *
 * 行为：
 * - 解析单个书的 JSON（支持两种顶层结构：bookTitle/author 或 book:{title,...}）
 * - 按 JSON 中 cards 的出现顺序插入（章内 idx 按出现顺序；全局展示顺序由 sortOrder 自增保证）
 * - 章节绑定：source 可解析出「第N篇/章/品/部/回」→ 绑定该章节；否则为直属卡（chapterId=null、idx=0）
 *   - 纯篇名书（如《庄子》：source 为「逍遥游」等篇名，无「第N」字样）用 --chapters 提供有序篇名表，
 *     按「source 包含篇名」匹配归章；多章名同时命中时取最长匹配（同长取书序靠前）；
 *     「章」结尾章名另有去尾「章」别名，兼容「第X、Y章」「第X至Y章」缩写引用
 *   - 双层编号书（如「第X卷·第Y章」）也走 --chapters：章名直接写成「第一卷·第一章」等全名，
 *     按书序拉平成全局章序（卷章号不进 parseChapterNum，避免「第N卷」被当成章号）
 * - 幂等：书按 slug upsert、章按 bookId+idx upsert、章节卡按 chapterId+idx upsert、
 *   直属卡按 bookId+chapterId:null+title 定位后 update/create
 *
 * 选项：
 *   --slug xxx            书的 slug（非 dry-run 时必填，除非库内已存在同名书）
 *   --tagline "..."       书的宣传语（可选）
 *   --chapters 名1,名2,…  有序章节名表（纯篇名书用；也用于预建含空章的完整章节结构）
 *   --active              导入后设为 ACTIVE（同时归档其他书；缺省创建为 ARCHIVED）
 *   --draft               导入后设为 DRAFT（缺省创建为 ARCHIVED；已存在的书默认保留原状态）
 *   --reset               导入前清空该书全部卡片（含 CardState）——章节映射变更后重导时必需
 *   --dry-run             只解析并打印导入计划，不写库
 *
 * 注意：
 * - 若两次运行之间章节归组规则变化（如 --chapters 表调整），chapterId+idx 的 upsert
 *   不会移动旧卡，需先 --reset 再导入
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()

interface DataCard {
  id?: string
  module: string
  name: string
  definition: string
  quote: string
  source: string
  reconstruct: string
  trigger: string
  boundaries: string[]
  level?: string
}

interface RawFile {
  bookTitle?: string
  bookSubtitle?: string
  author?: string
  book?: { title?: string; subtitle?: string; author?: string }
  totalCards?: number
  cards: DataCard[]
}

// ---------- CLI 参数解析 ----------

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const opts: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') {
      opts.dryRun = true
    } else if (a === '--active' || a === '--draft' || a === '--reset') {
      opts[a.slice(2)] = true
    } else if (a === '--slug' || a === '--tagline' || a === '--chapters') {
      opts[a.slice(2)] = argv[++i] ?? ''
    } else if (a.startsWith('--')) {
      throw new Error(`未知选项：${a}`)
    } else {
      positional.push(a)
    }
  }
  return { file: positional[0], opts }
}

// ---------- 中文数字 ----------

const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 中文数字 → 阿拉伯数字（覆盖 一~九十九） */
function cnNum(cn: string): number {
  if (cn === '十') return 10
  const m = cn.match(/^(([一二三四五六七八九])?十)?([一二三四五六七八九])?$/)
  if (!m) return NaN
  const tens = m[2] ? CN_DIGIT[m[2]] * 10 : m[1] ? 10 : 0
  const ones = m[3] ? CN_DIGIT[m[3]] : 0
  return tens + ones
}

// ---------- 章节归组 ----------

/** 章节标题清理：去掉书名号《…》与括注（…） */
function cleanTitle(source: string): string {
  return source.replace(/《.+?》/g, '').replace(/（.+?）/g, '').trim()
}

/**
 * 解析 source 中的章节序号，支持三种形态（按序尝试，取首个成功解析）：
 * 1. 「第N篇/章/品/部/回/节/卷」（如 第二十五章、第二部）
 * 2. 「第N、M章」顿号跨章引用（如 第三十六、七十六章）→ 取首个序号
 * 3. 「品/篇/… + 第N」结尾（如 行由品第一——单位在「第」前）
 * 无匹配返回 null（该卡归为直属卡）。
 */
function parseChapterNum(source: string): number | null {
  const s = cleanTitle(source)
  const patterns = [
    /第([一二三四五六七八九十百]+)[篇章节回品部卷]/,
    /第([一二三四五六七八九十百]+)[、，,]/,
    /[篇章节回品部卷]第([一二三四五六七八九十百]+)$/,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m) {
      const n = cnNum(m[1])
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

interface CardFields {
  module: string
  definition: string
  quote: string
  recast: string
  trigger: string
  boundaries: string[]
  source: string
}

interface Plan {
  book: { title: string; subtitle: string | null; author: string; slug: string; tagline: string | null }
  /** idx → { title, cards: 按出现顺序的卡名 } */
  chapters: Map<number, { title: string; cards: string[] }>
  /** 直属卡（chapterId=null）按出现顺序 */
  directCards: string[]
  cards: { name: string; chIdx: number | null; fields: CardFields }[]
}

function planOf(data: RawFile, chapterNames: string[] | null): Plan {
  if (data.totalCards !== undefined && data.cards.length !== data.totalCards) {
    throw new Error(`totalCards=${data.totalCards} 与实际卡数 ${data.cards.length} 不符`)
  }

  const title = data.bookTitle ?? data.book?.title
  const subtitle = data.bookSubtitle ?? data.book?.subtitle ?? null
  const author = data.author ?? data.book?.author
  if (!title || !author) throw new Error('JSON 缺少书名或作者（需 bookTitle/author 或 book.title/book.author）')

  const plan: Plan = {
    book: { title, subtitle, author, slug: '', tagline: null },
    chapters: new Map(),
    directCards: [],
    cards: [],
  }

  for (const c of data.cards) {
    const missing = (['module', 'name', 'definition', 'quote', 'source', 'reconstruct', 'trigger'] as const)
      .filter((k) => !c[k])
    if (missing.length > 0 || !Array.isArray(c.boundaries)) {
      throw new Error(`卡 ${c.id ?? '?'}「${c.name}」字段缺失：${missing.join(',') || 'boundaries'}`)
    }
  }

  for (const c of data.cards) {
    const fields = {
      module: c.module,
      definition: c.definition,
      quote: c.quote,
      recast: c.reconstruct,
      trigger: c.trigger,
      boundaries: c.boundaries,
      source: c.source,
    }
    let chIdx: number | null = null
    let chTitle = ''

    if (chapterNames) {
      // 有序章节名表：source 包含某章节名 → 归入该章。
      // 多个章节名都被 source 包含时取「最长匹配」（如 source「冬天的湖」
      // 应归《冬天的湖》而非子串命中的《湖》）；同长取书序靠前者
      // （跨章引用如「结束语、经济篇」归首章，与「第N、M章取首个序号」同口径）。
      // 以「章」结尾的章名另试去尾「章」的别名，兼容「第X、Y章」「第X至Y章」
      // 这类顿号/跨章缩写（如 source「第二卷·第一、二章」命中别名「第二卷·第一」）。
      let best = -1
      let bestLen = 0
      for (let i = 0; i < chapterNames.length; i++) {
        const n = chapterNames[i]
        const candidates = n.endsWith('章') ? [n, n.slice(0, -1)] : [n]
        for (const cand of candidates) {
          if (c.source.includes(cand) && cand.length > bestLen) {
            best = i
            bestLen = cand.length
          }
        }
      }
      if (best >= 0) {
        chIdx = best + 1
        chTitle = chapterNames[best]
      }
    } else {
      const n = parseChapterNum(c.source)
      if (n !== null) {
        chIdx = n
        // 章节标题取清理后的 source（如「行由品第一」「第二部」）
        chTitle = cleanTitle(c.source)
      }
    }

    plan.cards.push({ name: c.name, chIdx, fields })
    if (chIdx === null) {
      plan.directCards.push(c.name)
    } else {
      const ch = plan.chapters.get(chIdx)
      if (ch) {
        ch.cards.push(c.name)
      } else {
        plan.chapters.set(chIdx, { title: chTitle, cards: [c.name] })
      }
    }
  }

  // --chapters 提供的章节预建（可含空章），补全计划中缺失的章
  if (chapterNames) {
    for (let i = 0; i < chapterNames.length; i++) {
      if (!plan.chapters.has(i + 1)) {
        plan.chapters.set(i + 1, { title: chapterNames[i], cards: [] })
      }
    }
  }

  return plan
}

function printPlan(plan: Plan, file: string) {
  console.log(`\n=== 导入计划（${file}）===`)
  console.log(`书名：${plan.book.title}`)
  if (plan.book.subtitle) console.log(`副题：${plan.book.subtitle}`)
  console.log(`作者：${plan.book.author}`)
  console.log(`章节数：${plan.chapters.size}（含空章）`)
  for (const [idx, ch] of [...plan.chapters.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  第${idx}章 ${ch.title}：${ch.cards.length} 张卡`)
  }
  console.log(`直属卡（chapterId=null）：${plan.directCards.length} 张`)
  for (const n of plan.directCards) console.log(`  · ${n}`)
  console.log(`卡片总数：${plan.cards.length}`)
}

// ---------- 入库 ----------

async function importPlan(plan: Plan, opts: { slug?: string; tagline?: string; active?: boolean; draft?: boolean; reset?: boolean }) {
  const slug = plan.book.slug
  if (!slug) throw new Error('缺少 slug（用 --slug 指定）')

  const existing = await prisma.book.findUnique({ where: { slug }, select: { id: true, status: true } })

  // 状态：--active > --draft > 已存在保留原状态 > 创建为 ARCHIVED
  let status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | undefined
  if (opts.active) status = 'ACTIVE'
  else if (opts.draft) status = 'DRAFT'
  else if (!existing) status = 'ARCHIVED'

  if (opts.active) {
    await prisma.book.updateMany({ where: { status: 'ACTIVE', NOT: { slug } }, data: { status: 'ARCHIVED' } })
  }

  const book = await prisma.book.upsert({
    where: { slug },
    update: {
      title: plan.book.title,
      subtitle: plan.book.subtitle,
      author: plan.book.author,
      ...(opts.tagline !== undefined ? { tagline: opts.tagline || null } : {}),
      ...(status ? { status } : {}),
    },
    create: {
      slug,
      title: plan.book.title,
      subtitle: plan.book.subtitle,
      author: plan.book.author,
      tagline: opts.tagline || null,
      status: status ?? 'ARCHIVED',
    },
  })

  if (opts.reset) {
    const del = await prisma.card.deleteMany({ where: { bookId: book.id } })
    console.log(`--reset：已删除该书 ${del.count} 张卡（CardState 级联）`)
  }

  // 章节 upsert（bookId+idx）
  const chapters = new Map<number, string>()
  for (const [idx, ch] of [...plan.chapters.entries()].sort((a, b) => a[0] - b[0])) {
    const row = await prisma.chapter.upsert({
      where: { bookId_idx: { bookId: book.id, idx } },
      update: { title: ch.title },
      create: { bookId: book.id, idx, title: ch.title },
    })
    chapters.set(idx, row.id)
  }

  // 卡片：章内 idx 按 JSON 出现顺序；直属卡 chapterId=null、idx=0
  const perChapter = new Map<number, number>()
  for (const c of plan.cards) {
    if (c.chIdx !== null) {
      const chapterId = chapters.get(c.chIdx)!
      const idx = (perChapter.get(c.chIdx) ?? 0) + 1
      perChapter.set(c.chIdx, idx)
      await prisma.card.upsert({
        where: { chapterId_idx: { chapterId, idx } },
        update: { title: c.name, ...c.fields },
        create: { bookId: book.id, chapterId, idx, title: c.name, status: 'APPROVED', ...c.fields },
      })
    } else {
      const existing = await prisma.card.findFirst({
        where: { bookId: book.id, chapterId: null, title: c.name },
        select: { id: true },
      })
      if (existing) {
        await prisma.card.update({ where: { id: existing.id }, data: { title: c.name, ...c.fields } })
      } else {
        await prisma.card.create({
          data: { bookId: book.id, chapterId: null, idx: 0, title: c.name, status: 'APPROVED', ...c.fields },
        })
      }
    }
  }

  const cardCount = await prisma.card.count({ where: { bookId: book.id } })
  console.log(
    '✓ %s（%s）：chapters=%d, cards=%d（全 APPROVED，%s）',
    plan.book.title,
    slug,
    chapters.size,
    cardCount,
    (status ?? existing?.status ?? 'ARCHIVED'),
  )
}

async function main() {
  const { file, opts } = parseArgs(process.argv.slice(2))
  if (!file) throw new Error('用法：pnpm exec tsx scripts/import-book.ts <book_data.json> [选项]')

  const filePath = path.resolve(process.cwd(), file)
  const data = JSON.parse(readFileSync(filePath, 'utf-8')) as RawFile

  const chapterNames = typeof opts.chapters === 'string' && opts.chapters
    ? opts.chapters.split(',').map((s) => s.trim()).filter(Boolean)
    : null

  const plan = planOf(data, chapterNames)
  plan.book.slug = typeof opts.slug === 'string' ? opts.slug : ''
  plan.book.tagline = typeof opts.tagline === 'string' ? opts.tagline : null

  printPlan(plan, path.basename(filePath))

  if (opts.dryRun) {
    console.log('\n（--dry-run：未写库）')
    return
  }

  if (!plan.book.slug) {
    throw new Error('非 dry-run 需要 --slug xxx（书的唯一标识）')
  }
  await importPlan(plan, opts as { slug?: string; tagline?: string; active?: boolean; draft?: boolean; reset?: boolean })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
