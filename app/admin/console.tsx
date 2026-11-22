'use client'

import {
  Alert,
  Button,
  Card,
  Collapse,
  Col,
  ConfigProvider,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import zhCN from 'antd/locale/zh_CN'
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  BarChartOutlined,
  BookOutlined,
  CaretDownOutlined,
  CheckCircleOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReadOutlined,
  SearchOutlined,
  StarOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { signOut } from 'next-auth/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { adminTheme } from './theme'

/* ---------------- 类型 ---------------- */

interface AdminCard {
  id: string
  idx: number
  sortOrder: number
  module: string
  title: string
  definition: string
  quote: string
  recast: string
  trigger: string
  boundaries: string[]
  source: string
  status: 'DRAFT' | 'APPROVED'
}

interface AdminChapter {
  id: string
  idx: number
  title: string
  cards: AdminCard[]
}

interface AdminBook {
  id: string
  title: string
  author: string
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  chapters: AdminChapter[]
  cards: AdminCard[] // 直属卡（无章节的非公版书）
}

interface Stats {
  users: number
  cards: { total: number; approved: number; draft: number }
  reviewedCount: number
  averageScore: number
  recentReviews: { id: string; title: string; score: number | null; tier: number | null; reviewedAt: string | null }[]
}

interface CardFormFields {
  module: string
  title: string
  definition: string
  quote: string
  recast: string
  trigger: string
  boundaries: string
  source: string
  status: 'DRAFT' | 'APPROVED'
}

interface CardFormData {
  module: string
  title: string
  definition: string
  quote: string
  recast: string
  trigger: string
  boundaries: string[]
  source: string
  status: 'DRAFT' | 'APPROVED'
}

/* ---------------- 视觉常量（Ant Design 规范：状态语义色 / 中性文字分层） ---------------- */

const BOOK_STATUS_META: Record<AdminBook['status'], { label: string; color: string }> = {
  DRAFT: { label: '草稿', color: 'gold' },
  ACTIVE: { label: '在学', color: 'green' },
  ARCHIVED: { label: '已归档', color: 'default' },
}

const TIER_META = [
  { label: '有点遗忘', color: 'volcano' },
  { label: '记得一些', color: 'gold' },
  { label: '很巩固', color: 'green' },
] as const

/** 文字弱层级（规范中性色板）/ 分隔线 */
const TEXT_3RD = 'rgba(0,0,0,0.45)'
const LINE = '#f0f0f0'

function fmtTime(v: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------------- 控制台 ---------------- */

export default function AdminConsole({ operator }: { operator: string }) {
  return (
    <ConfigProvider theme={adminTheme} locale={zhCN}>
      <div style={{ minHeight: '100vh', background: '#f5f6fa' }}>
        {/* 顶栏：品牌 + 操作者 + 退出 */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'saturate(180%) blur(8px)',
            borderBottom: `1px solid ${LINE}`,
          }}
        >
          <Flex align="center" gap={10} style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px', height: 56 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #4096ff, #1677ff)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: 16,
                flex: 'none',
              }}
            >
              念
            </div>
            <Typography.Text strong style={{ fontSize: 16 }}>
              一念·精读
            </Typography.Text>
            <Typography.Text type="secondary">管理台</Typography.Text>
            <div style={{ flex: 1 }} />
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {operator}
            </Tag>
            <Button type="text" icon={<LogoutOutlined />} onClick={() => signOut({ redirectTo: '/admin/login' })}>
              退出
            </Button>
          </Flex>
        </header>

        <main style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 24px 56px' }}>
          <Tabs
            defaultActiveKey="cards"
            size="large"
            items={[
              {
                key: 'cards',
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <BookOutlined />
                    卡片管理
                  </span>
                ),
                children: <CardsTab />,
              },
              {
                key: 'stats',
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <BarChartOutlined />
                    运营数据
                  </span>
                ),
                children: <StatsTab />,
              },
            ]}
          />
        </main>
      </div>
    </ConfigProvider>
  )
}

/* ---------------- 状态标签下拉（书状态流转） ---------------- */

function StatusTagDropdown({
  value,
  onChange,
}: {
  value: AdminBook['status']
  onChange: (s: AdminBook['status']) => void
}) {
  const meta = BOOK_STATUS_META[value]
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: (Object.keys(BOOK_STATUS_META) as AdminBook['status'][]).map((s) => ({
          key: s,
          label: BOOK_STATUS_META[s].label,
        })),
        selectedKeys: [value],
        onClick: ({ key }) => onChange(key as AdminBook['status']),
      }}
    >
      <Tag color={meta.color} style={{ cursor: 'pointer', marginInlineEnd: 0 }}>
        {meta.label} <CaretDownOutlined style={{ fontSize: 10 }} />
      </Tag>
    </Dropdown>
  )
}

/* ---------------- 卡片管理：书单 → 书内卡编辑（两级，进书才拉全量卡） ---------------- */

/** 书单行（轻量：仅计数，不嵌卡内容） */
interface AdminBookRow {
  id: string
  slug: string
  title: string
  subtitle: string | null
  author: string
  status: AdminBook['status']
  sortOrder: number
  chapterCount: number
  cardCount: number
  approvedCount: number
}

function CardsTab() {
  const [books, setBooks] = useState<AdminBookRow[] | null>(null)
  const [keyword, setKeyword] = useState('')
  /** 当前进入的书（null = 书单页） */
  const [book, setBook] = useState<AdminBook | null>(null)
  const [entering, setEntering] = useState(false)
  const [bookError, setBookError] = useState('')
  const [editing, setEditing] = useState<AdminCard | null>(null)
  // 新卡挂载点：章节卡（chapterId）或直属卡（bookId），label 用于弹窗标题
  const [creatingIn, setCreatingIn] = useState<{ label: string; chapterId?: string; bookId?: string } | null>(null)

  const reloadList = useCallback(() => {
    fetch('/api/admin/books')
      .then((r) => (r.ok ? r.json() : { books: [] }))
      .then((d) => setBooks(d.books))
  }, [])
  useEffect(reloadList, [reloadList])

  /** 进入某本书：拉该书全部章节 + 卡片 */
  async function openBook(id: string) {
    if (entering) return
    setEntering(true)
    setBookError('')
    try {
      const d = await fetch(`/api/admin/cards?bookId=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null))
      if (d?.book) setBook(d.book)
      else setBookError('加载卡组失败，请重试')
    } catch {
      setBookError('加载卡组失败，请重试')
    } finally {
      setEntering(false)
    }
  }

  /** 书内改动（新建/编辑卡）后：重拉当前书 + 后台刷新书单计数 */
  function reloadBook() {
    if (book) void openBook(book.id)
    reloadList()
  }

  /** 切书状态（ACTIVE 全局唯一由后端保证）；本地同步 + 后台刷新书单 */
  async function changeBookStatus(id: string, status: AdminBook['status']) {
    await fetch('/api/admin/books', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setBooks((bs) => (bs ? bs.map((b) => (b.id === id ? { ...b, status } : b)) : bs))
    setBook((bk) => (bk && bk.id === id ? { ...bk, status } : bk))
    reloadList()
  }

  /** 发现页排序：上移/下移（按全量书单重编号 1..N 一次性写库，乐观更新，失败回滚刷新） */
  async function moveBook(id: string, dir: -1 | 1) {
    if (!books) return
    const idx = books.findIndex((b) => b.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= books.length) return
    const next = [...books]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    const ordered = next.map((b, i) => ({ ...b, sortOrder: i + 1 }))
    setBooks(ordered)
    try {
      const r = await fetch('/api/admin/books', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: ordered.map((b) => ({ id: b.id, sortOrder: b.sortOrder })) }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch {
      setBookError('排序保存失败，请重试')
      reloadList()
    }
  }

  const filtered = useMemo(() => {
    if (!books) return []
    const k = keyword.trim().toLowerCase()
    if (!k) return books
    return books.filter((b) => `${b.title} ${b.subtitle ?? ''} ${b.author} ${b.slug}`.toLowerCase().includes(k))
  }, [books, keyword])
  const totalApproved = books?.reduce((s, b) => s + b.approvedCount, 0) ?? 0

  /* --- 一级：书单 --- */
  const bookColumns: ColumnsType<AdminBookRow> = [
    {
      title: '书名',
      dataIndex: 'title',
      render: (v: string, r: AdminBookRow) => (
        <Flex align="center" gap={12}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: '#e8f3ff',
              color: '#1677ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <BookOutlined />
          </div>
          <Typography.Text strong>{v}</Typography.Text>
        </Flex>
      ),
    },
    { title: '作者', dataIndex: 'author', width: 130 },
    {
      title: '章节',
      dataIndex: 'chapterCount',
      width: 72,
      align: 'right',
      render: (v: number) => (v > 0 ? v : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: '卡片（上架/总）',
      width: 130,
      align: 'right',
      render: (_: unknown, r: AdminBookRow) => (
        <Typography.Text strong={r.cardCount > 0 && r.approvedCount === r.cardCount}>
          {r.approvedCount}
          <Typography.Text type="secondary"> / {r.cardCount}</Typography.Text>
        </Typography.Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 104,
      // 阻断冒泡：点状态下拉不进书详情
      render: (s: AdminBook['status'], r: AdminBookRow) => (
        <div onClick={(e) => e.stopPropagation()}>
          <StatusTagDropdown value={s} onChange={(v) => void changeBookStatus(r.id, v)} />
        </div>
      ),
    },
    {
      // 发现页顺序：上移/下移即时保存（按全量书单重编号）
      title: '排序',
      width: 88,
      render: (_: unknown, r: AdminBookRow) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Space size={0}>
            <Button
              type="text"
              size="small"
              icon={<ArrowUpOutlined />}
              onClick={() => void moveBook(r.id, -1)}
            />
            <Button
              type="text"
              size="small"
              icon={<ArrowDownOutlined />}
              onClick={() => void moveBook(r.id, 1)}
            />
          </Space>
        </div>
      ),
    },
    {
      title: '',
      width: 96,
      render: (_: unknown, r: AdminBookRow) => (
        <Button
          type="link"
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            void openBook(r.id)
          }}
        >
          编辑卡片
        </Button>
      ),
    },
  ]

  if (!book) {
    return (
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {bookError && <Alert type="error" showIcon title={bookError} closable onClose={() => setBookError('')} />}
        <Card styles={{ body: { padding: 0 } }}>
          {/* 工具条：搜索 + 概览 */}
          <Flex
            align="center"
            gap={12}
            wrap="wrap"
            style={{ padding: '14px 16px', borderBottom: `1px solid ${LINE}` }}
          >
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: TEXT_3RD }} />}
              placeholder="搜索书名、作者"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 240 }}
            />
            <Typography.Text type="secondary" style={{ marginLeft: 'auto', fontSize: 13 }}>
              共 {books?.length ?? 0} 本书 · 累计上架 {totalApproved} 张卡
            </Typography.Text>
          </Flex>
          <Table
            rowKey="id"
            size="middle"
            columns={bookColumns}
            dataSource={filtered}
            loading={books === null}
            pagination={false}
            onRow={(r) => ({ onClick: () => void openBook(r.id), style: { cursor: 'pointer' } })}
          />
        </Card>
        {entering && <Card loading style={{ minHeight: 160 }} />}
      </Space>
    )
  }

  /* --- 二级：书内卡编辑 --- */
  const allCards = [...book.chapters.flatMap((ch) => ch.cards), ...book.cards]
  const approvedCount = allCards.filter((c) => c.status === 'APPROVED').length
  const approvePct = allCards.length > 0 ? Math.round((approvedCount / allCards.length) * 100) : 0

  // 章节卡序号用章节内 idx，直属卡用全局 sortOrder
  const columns = (direct: boolean): ColumnsType<AdminCard> => [
    {
      title: '#',
      dataIndex: direct ? 'sortOrder' : 'idx',
      width: 56,
      render: (v: number) => <Typography.Text type="secondary">{v}</Typography.Text>,
    },
    {
      title: '卡名',
      dataIndex: 'title',
      width: 200,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '模块',
      dataIndex: 'module',
      width: 120,
      ellipsis: true,
      render: (v: string) =>
        v ? <Tag style={{ marginInlineEnd: 0 }}>{v}</Tag> : <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: '定义', dataIndex: 'definition', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: AdminCard['status']) =>
        s === 'APPROVED' ? (
          <Tag color="green" style={{ marginInlineEnd: 0 }}>
            已上架
          </Tag>
        ) : (
          <Tag color="gold" style={{ marginInlineEnd: 0 }}>
            草稿
          </Tag>
        ),
    },
    {
      title: '操作',
      width: 72,
      render: (_: unknown, c: AdminCard) => (
        <Button type="link" size="small" onClick={() => setEditing({ ...c, boundaries: [...c.boundaries] })}>
          编辑
        </Button>
      ),
    },
  ]

  const cardTable = (direct: boolean, cards: AdminCard[]) => (
    <Table rowKey="id" size="small" columns={columns(direct)} dataSource={cards} pagination={false} />
  )

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {/* 书详情头：返回 + 书信息 + 上架进度 + 状态 */}
      <Card styles={{ body: { padding: '16px 20px' } }}>
        <Flex align="center" gap={12} wrap="wrap">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              setBook(null)
              setBookError('')
            }}
          >
            返回书单
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {book.title}
          </Typography.Title>
          <Typography.Text type="secondary">{book.author}</Typography.Text>
          <div style={{ flex: 1 }} />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {book.chapters.length > 0 && `${book.chapters.length} 章 · `}
            上架 <Typography.Text strong>{approvedCount}</Typography.Text> / {allCards.length}
          </Typography.Text>
          <StatusTagDropdown value={book.status} onChange={(v) => void changeBookStatus(book.id, v)} />
        </Flex>
        {allCards.length > 0 && (
          <Progress
            percent={approvePct}
            size="small"
            showInfo={false}
            strokeColor={approvePct === 100 ? '#52c41a' : '#1677ff'}
            style={{ marginTop: 14, marginBottom: 0 }}
          />
        )}
      </Card>

      <Collapse
        items={[
          ...book.chapters.map((ch) => ({
            key: ch.id,
            label: (
              <Space size={8}>
                <Typography.Text strong>
                  {ch.idx}. {ch.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {ch.cards.length} 张卡
                </Typography.Text>
              </Space>
            ),
            extra: (
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  setCreatingIn({ label: ch.title, chapterId: ch.id })
                }}
              >
                新卡
              </Button>
            ),
            children: cardTable(false, ch.cards),
          })),
          // 直属卡区：有直属卡的书显示；纯无章节书即使为空也显示，保证可建卡
          ...(book.cards.length > 0 || book.chapters.length === 0
            ? [
                {
                  key: `${book.id}-direct`,
                  label: (
                    <Space size={8}>
                      <Typography.Text strong>直属卡（无章节）</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {book.cards.length} 张卡
                      </Typography.Text>
                    </Space>
                  ),
                  extra: (
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        setCreatingIn({ label: `${book.title}·直属卡`, bookId: book.id })
                      }}
                    >
                      新卡
                    </Button>
                  ),
                  children: cardTable(true, book.cards),
                },
              ]
            : []),
        ]}
      />

      {editing && (
        <CardFormModal
          title={`编辑卡 #${editing.sortOrder}`}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            await fetch('/api/admin/cards', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: editing.id, ...data }),
            })
            setEditing(null)
            reloadBook()
          }}
        />
      )}
      {creatingIn && (
        <CardFormModal
          title={`新建卡（${creatingIn.label}）`}
          onClose={() => setCreatingIn(null)}
          onSubmit={async (data) => {
            await fetch('/api/admin/cards', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...(creatingIn.chapterId ? { chapterId: creatingIn.chapterId } : { bookId: creatingIn.bookId }),
                ...data,
              }),
            })
            setCreatingIn(null)
            reloadBook()
          }}
        />
      )}
    </Space>
  )
}

/* ---------------- 卡片表单弹窗 ---------------- */

function CardFormModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string
  initial?: AdminCard
  onClose: () => void
  onSubmit: (data: CardFormData) => Promise<void>
}) {
  const [form] = Form.useForm<CardFormFields>()
  const [saving, setSaving] = useState(false)

  async function handleOk() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await onSubmit({
        ...values,
        boundaries: values.boundaries
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={title}
      open
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      centered
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          {
            module: initial?.module ?? '',
            title: initial?.title ?? '',
            definition: initial?.definition ?? '',
            quote: initial?.quote ?? '',
            recast: initial?.recast ?? '',
            trigger: initial?.trigger ?? '',
            boundaries: (initial?.boundaries ?? []).join('\n'),
            source: initial?.source ?? '',
            status: initial?.status ?? 'DRAFT',
          } satisfies CardFormFields
        }
      >
        <Form.Item name="module" label="模块" extra="卡组名，如「觉察根源」，可留空">
          <Input placeholder="可留空" />
        </Form.Item>
        <Form.Item name="title" label="卡名" rules={[{ required: true, message: '请输入卡名' }]}>
          <Input />
        </Form.Item>
        <Form.Item
          name="definition"
          label="定义"
          extra="一句话命题"
          rules={[{ required: true, message: '请输入定义' }]}
        >
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="quote" label="原文摘录">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="recast" label="重构阐释" extra="用现代人的话展开">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item
          name="trigger"
          label="触发问句"
          extra="复习时向用户提问的句子"
          rules={[{ required: true, message: '请输入触发问句' }]}
        >
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="boundaries" label="边界" extra="每行一条，适用条件或反例">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="source" label="出处">
          <Input />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select
            options={[
              { value: 'DRAFT', label: 'DRAFT（草稿）' },
              { value: 'APPROVED', label: 'APPROVED（上架）' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/* ---------------- 运营数据 ---------------- */

/** KPI 卡：软色图标位 + Statistic + 虚线分隔的补充说明 */
function KpiCard({
  icon,
  tint,
  bg,
  title,
  value,
  suffix,
  footer,
}: {
  icon: ReactNode
  tint: string
  bg: string
  title: string
  value: number | string
  suffix?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card styles={{ body: { padding: 20, height: '100%' } }}>
      <Flex align="center" gap={14}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: bg,
            color: tint,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flex: 'none',
          }}
        >
          {icon}
        </div>
        <Statistic title={title} value={value} suffix={suffix} />
      </Flex>
      {footer && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px dashed ${LINE}`,
            fontSize: 12,
            color: TEXT_3RD,
          }}
        >
          {footer}
        </div>
      )}
    </Card>
  )
}

function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    setError('')
    fetch('/api/admin/stats')
      .then(async (r) => {
        // 先兜住空体/非 JSON（如 dev 热重载打断响应），再判状态
        const d = (await r.json().catch(() => null)) as Stats | null
        if (!alive) return
        if (!r.ok || !d) throw new Error(`HTTP ${r.status}`)
        setStats(d)
      })
      .catch(() => {
        if (alive) setError('数据加载失败，请重试')
      })
    return () => {
      alive = false
    }
  }, [retry])

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        title={error}
        action={
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            重试
          </Button>
        }
      />
    )
  }
  if (!stats) {
    return (
      <Row gutter={[16, 16]}>
        {[0, 1, 2, 3].map((i) => (
          <Col key={i} xs={12} md={6}>
            <Card loading style={{ height: 132 }} />
          </Col>
        ))}
        <Col span={24}>
          <Card loading style={{ height: 260 }} />
        </Col>
      </Row>
    )
  }

  const approvePct = stats.cards.total > 0 ? Math.round((stats.cards.approved / stats.cards.total) * 100) : 0
  const subSuffix = <span style={{ fontSize: 14, color: TEXT_3RD }}>/ 10</span>

  const reviewColumns: ColumnsType<Stats['recentReviews'][number]> = [
    {
      title: '时间',
      dataIndex: 'reviewedAt',
      width: 170,
      render: (v: string | null) => <Typography.Text type="secondary">{fmtTime(v)}</Typography.Text>,
    },
    {
      title: '卡片',
      dataIndex: 'title',
      ellipsis: true,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '结论',
      dataIndex: 'tier',
      width: 110,
      render: (t: number | null) =>
        t != null && t in TIER_META ? (
          <Tag color={TIER_META[t].color} style={{ marginInlineEnd: 0 }}>
            {TIER_META[t].label}
          </Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '评分',
      dataIndex: 'score',
      width: 90,
      align: 'right',
      render: (s: number | null) =>
        s != null ? (
          <>
            <Typography.Text strong>{s}</Typography.Text>
            <Typography.Text type="secondary"> 分</Typography.Text>
          </>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
  ]

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<TeamOutlined />}
            tint="#1677ff"
            bg="#e8f3ff"
            title="注册用户"
            value={stats.users}
            footer="累计微信授权用户"
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<ReadOutlined />}
            tint="#722ed1"
            bg="#f9f0ff"
            title="知识卡片"
            value={stats.cards.approved}
            suffix={<span style={{ fontSize: 14, color: TEXT_3RD }}> / {stats.cards.total}</span>}
            footer={
              stats.cards.total > 0 ? (
                <div>
                  <div style={{ marginBottom: 6 }}>
                    上架率 {approvePct}%
                    {stats.cards.draft > 0 && ` · 含 ${stats.cards.draft} 张草稿`}
                  </div>
                  <Progress
                    percent={approvePct}
                    size="small"
                    showInfo={false}
                    strokeColor="#722ed1"
                    style={{ marginBottom: 0 }}
                  />
                </div>
              ) : undefined
            }
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<CheckCircleOutlined />}
            tint="#52c41a"
            bg="#f6ffed"
            title="完成复习"
            value={stats.reviewedCount}
            footer="所有用户累计复习次数"
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<StarOutlined />}
            tint="#faad14"
            bg="#fffbe6"
            title="平均评分"
            value={stats.averageScore}
            suffix={subSuffix}
            footer="AI 十分制 · 最近一次"
          />
        </Col>
      </Row>

      <Card
        title="最近复习"
        extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>最新 10 条</Typography.Text>}
      >
        {stats.recentReviews.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有复习记录" />
        ) : (
          <Table rowKey="id" size="small" columns={reviewColumns} dataSource={stats.recentReviews} pagination={false} />
        )}
      </Card>
    </Space>
  )
}
