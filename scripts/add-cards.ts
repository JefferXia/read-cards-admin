/**
 * 内容管线第二步：AI 生成卡片草稿 → 入库（DRAFT）→ 管理台人工审核 → APPROVED
 *
 * 本文件即「AI 生成」环节的产出：基于公版书《幸福之路》第一章、第二章
 * 的原文要义改写，不摘录原文段落，不露书名以外的版权信息。
 *
 * 用法：pnpm tsx scripts/add-cards.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface Draft {
  chapterIdx: number
  title: string
  definition: string
  quote: string
  recast: string
  trigger: string
  boundaries: string[]
  source: string
}

const DRAFTS: Draft[] = [
  // ---------- 第一章补齐（原 seed 已有 4 张） ----------
  {
    chapterIdx: 1,
    title: '两类不幸福',
    definition: '不幸福有两类来源：一类是社会制度的问题，一类是个人的心理问题；改变制度靠共同努力，处理心理得从自己入手。',
    quote: '',
    recast: '罗素把不幸福拆成两半：贫困、疾病、不合理的社会安排，这些要靠集体的改良；而那些「什么都有却仍然不快乐」的人，问题出在自己与自己的关系上。后一类人无法等待世界先变好——能动的第一步，是检查自己看待生活的方式。',
    trigger: '你眼下的不快乐，有多少是「处境问题」，有多少是「看待方式问题」？',
    boundaries: [],
    source: '第一章 开篇',
  },
  {
    chapterIdx: 1,
    title: '客观的兴趣',
    definition: '幸福的人以客观的兴趣为中心，把不幸的人困在里面的那面墙，恰恰是过度自我关注砌起来的。',
    quote: '',
    recast: '罗素观察到的快乐者有个共性：他们对世界——人、事、观念——保有真实的兴趣，自我只是众多关切中的一员。而不幸者的注意力像探照灯一样全部打回自己：自己够不够成功、别人怎么看自己、自己错过了什么。墙内的世界越封闭，外界的养分越进不来。',
    trigger: '最近一周，你为「与己无关的事」产生过纯粹的高兴吗？',
    boundaries: [],
    source: '第一章 结尾',
  },
  // ---------- 第二章 拜伦式的不幸 ----------
  {
    chapterIdx: 2,
    title: '悲观的姿态',
    definition: '把「看破红尘」当成深刻，是一种时髦的幻觉——悲观的姿态常常不是清醒，而是自我装饰。',
    quote: '',
    recast: '罗素指出，以厌倦和轻蔑标榜自己看得透彻，在安乐时代特别流行。这种姿态让人误以为悲观者比乐观者更聪明。但他提醒：没有证据表明痛苦的人对世界的判断更准确；恰恰相反，长期低落会系统性地扭曲观察。深刻与否，要看论据，不看表情。',
    trigger: '你有没有过「用沮丧显得深刻」的时刻？那时你看到的世界，事后看准吗？',
    boundaries: [],
    source: '第二章',
  },
  {
    chapterIdx: 2,
    title: '情绪不是论证',
    definition: '情绪不是论证。在最消沉的时刻得出的关于人生价值的结论，恰恰最不可信。',
    quote: '',
    recast: '人不会在发烧时对宇宙本质下判断，却常在情绪低谷时宣布「一切都没意思」。罗素说：情绪低落时对人生的否定，与发烧时的胡话属于同一类——是状态的产物，不是思考的产物。所以不要在谷底给人生定罪；等状态回来再重新审视一遍。',
    trigger: '回想一次你在低谷时下的重大结论，它经得起现在状态的检验吗？',
    boundaries: [],
    source: '第二章',
  },
  {
    chapterIdx: 2,
    title: '热爱的检验',
    definition: '不爱自己的人生观，不可能是完全正确的——对世界的兴趣与明智是同一枚硬币的两面。',
    quote: '',
    recast: '罗素提出一个检验标准：任何「值得活的人生观」必须能解释并容纳人对美好事物的热爱。把人生说成一场徒劳的哲学，即便逻辑自洽，也在经验上失败——因为它要求人放弃他天然热爱的东西。怀疑可以是工具，但不能是终点。',
    trigger: '你持有一个「说服你不要再热爱任何东西」的观念吗？它给你的生活带来了什么？',
    boundaries: [],
    source: '第二章',
  },
  {
    chapterIdx: 2,
    title: '生存还是意义',
    definition: '嘴上说「为生存而挣扎」的人，多数早已越过温饱——他们体会的是多余之苦，不是生存之苦。',
    quote: '',
    recast: '真正被饥饿威胁的人不谈论拜伦式的厌倦。罗素观察到，把「生存斗争」挂在嘴边的，往往是买了多余的马和马车的人：他们缺的不是面包，而是意义感的出口。把这两类痛苦分开，才能对症——前者的解药在保障，后者的解药在兴趣与联结。',
    trigger: '你说的「生存压力」，具体缺的是基本保障，还是意义与兴致？',
    boundaries: [],
    source: '第二章',
  },
  {
    chapterIdx: 2,
    title: '厌倦是状态',
    definition: '厌倦不是思考的结论，而是一种需要被治疗的状态——它像消化不良，靠推理治不好。',
    quote: '',
    recast: '有人把厌世感当成对世界深思熟虑后的裁决。罗素说不对：厌倦感更像身体的不适，源于精力无处安放、兴趣无处投递。它不会因为你想通了什么而消失，只会因为你真的去做、去爱、去关注了什么而缓解。先处理状态，再谈观点。',
    trigger: '你的「没意思」感，更接近一个想法，还是一种身体上的空？',
    boundaries: [],
    source: '第二章',
  },
]

async function main() {
  const book = await prisma.book.findUnique({
    where: { slug: 'the-conquest-of-happiness' },
    include: { chapters: { orderBy: { idx: 'asc' } } },
  })
  if (!book) throw new Error('先运行 pnpm seed')

  let created = 0
  for (const d of DRAFTS) {
    const ch = book.chapters.find((c) => c.idx === d.chapterIdx)
    if (!ch) throw new Error(`章节 ${d.chapterIdx} 不存在，先在管理台/seed 补建章节`)
    const last = await prisma.card.findFirst({
      where: { chapterId: ch.id },
      orderBy: { idx: 'desc' },
      select: { idx: true },
    })
    // 幂等：同章同定义跳过
    const exists = await prisma.card.findFirst({
      where: { chapterId: ch.id, definition: d.definition },
      select: { id: true },
    })
    if (exists) continue
    await prisma.card.create({
      data: {
        chapterId: ch.id,
        idx: (last?.idx ?? 0) + 1,
        title: d.title,
        definition: d.definition,
        quote: d.quote,
        recast: d.recast,
        trigger: d.trigger,
        boundaries: d.boundaries,
        source: d.source,
        status: 'DRAFT',
      },
    })
    created++
  }
  console.log(`AI 草稿入库：新增 ${created} 张（DRAFT，待管理台审核）`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
