/**
 * 只读审计：扫描 audioUrl 为空的卡的 recast，找出可能影响 TTS 朗读的内容。
 * 用法：cd /Users/xia/ai/yinian-read-web && node --env-file=.env scripts/tts-audit.mjs
 * 不写库、不调 MiniMax，仅打印报告。
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** 常见中文正文允许出现的字符白名单（用于「异常字符」频次统计） */
const COMMON = /^[\u4e00-\u9fffA-Za-z0-9，。！？；：、（）“”‘’……——·\-—%\s\n]$/

function ctx(text, m) {
  const i = m.index
  const s = Math.max(0, i - 15)
  const e = Math.min(text.length, i + m[0].length + 15)
  return `…${text.slice(s, e).replace(/\n/g, '⏎')}…`
}

async function main() {
  const cards = await prisma.card.findMany({
    where: { audioUrl: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, title: true, recast: true },
  })
  console.log(`待合成卡共 ${cards.length} 张\n`)

  const buckets = {
    LQ_RQ标记: [],
    英文字母或缩写: [],
    特殊符号: [], // * # ` ~ | \ / < > [ ] { } @ & 等
    emoji或非常用符号: [],
    含换行: [],
    含半角引号: [],
  }

  /** 未知异常字符频次：白名单外逐字统计，兜底发现分类没盖住的怪东西 */
  const charFreq = new Map()

  for (const c of cards) {
    const text = c.recast ?? ''
    if (!text.trim()) {
      buckets.LQ_RQ标记 // 占位不单独开桶，空阐释在下面单独列
      continue
    }
    if (/LQ|RQ/i.test(text)) buckets.LQ_RQ标记.push(c)
    const latins = text.match(/[A-Za-z]{1,}/g)
    if (latins) buckets.英文字母或缩写.push({ c, latins })
    if (/[*_#`~|\\/<>\[\]{}@&$^＝=]/.test(text)) buckets.特殊符号.push(c)
    if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2500}-\u{25FF}]/u.test(text))
      buckets.emoji或非常用符号.push(c)
    if (/\n/.test(text)) buckets.含换行.push(c)
    if (/["']/.test(text)) buckets.含半角引号.push(c)

    for (const ch of text) {
      if (!COMMON.test(ch) && ch.trim() !== '') {
        charFreq.set(ch, (charFreq.get(ch) ?? 0) + 1)
      }
    }
  }

  const empty = cards.filter((c) => !(c.recast ?? '').trim())
  for (const [k, list] of Object.entries(buckets)) {
    console.log(`\n== ${k}：${list.length} 张 ==`)
    for (const item of list.slice(0, 60)) {
      if (k === '英文字母或缩写') {
        const { c, latins } = item
        const m = /[A-Za-z]{1,}/.exec(c.recast ?? '')
        console.log(`  [${c.title}] 词: ${latins.slice(0, 8).join(',')} | ${ctx(c.recast ?? '', m)}`)
      } else {
        const c = item
        const re =
          k === 'LQ_RQ标记'
            ? /LQ|RQ/i
            : k === '特殊符号'
              ? /[*_#`~|\\/<>\[\]{}@&$^＝=]/
              : k === 'emoji或非常用符号'
                ? /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2500}-\u{25FF}]/u
                : k === '含换行'
                  ? /\n/
                  : /["']/
        const m = re.exec(c.recast ?? '')
        console.log(`  [${c.title}] ${ctx(c.recast ?? '', m)}`)
      }
    }
    if (list.length > 60) console.log(`  …（其余 ${list.length - 60} 张略）`)
  }

  console.log(`\n== 空阐释（无法合成，${empty.length} 张）==`)
  for (const c of empty) console.log(`  [${c.title}]`)

  console.log(`\n== 异常字符频次（白名单外，兜底排查）==`)
  const sorted = [...charFreq.entries()].sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) console.log('  无')
  for (const [ch, n] of sorted) {
    const code = ch.codePointAt(0).toString(16).padStart(4, '0')
    console.log(`  "${ch}" U+${code} × ${n}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
