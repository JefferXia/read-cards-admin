'use client'

import {
  Button,
  Card,
  Collapse,
  Col,
  Flex,
  Form,
  Input,
  Modal,
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
import { signOut } from 'next-auth/react'
import { useCallback, useEffect, useState } from 'react'

/* ---------------- 类型 ---------------- */

interface AdminCard {
  id: string
  idx: number
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
  chapters: AdminChapter[]
}

interface Stats {
  users: number
  cards: { total: number; approved: number; draft: number }
  reviewedCount: number
  averageScore: number
  recentReviews: { id: string; title: string; score: number | null; tier: number | null; reviewedAt: string | null }[]
}

const TIER_LABEL = ['有点遗忘', '记得一些', '很巩固']

interface CardFormFields {
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
  title: string
  definition: string
  quote: string
  recast: string
  trigger: string
  boundaries: string[]
  source: string
  status: 'DRAFT' | 'APPROVED'
}

/* ---------------- 控制台 ---------------- */

export default function AdminConsole({ operator }: { operator: string }) {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 24 }}>
      <Flex align="center" gap={16} style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          一念·精读 管理台
        </Typography.Title>
        <Typography.Text type="secondary">{operator}</Typography.Text>
        <Button
          style={{ marginLeft: 'auto' }}
          type="text"
          size="small"
          onClick={() => signOut({ redirectTo: '/admin/login' })}
        >
          退出
        </Button>
      </Flex>

      <Tabs
        defaultActiveKey="cards"
        items={[
          { key: 'cards', label: '卡片', children: <CardsTab /> },
          { key: 'stats', label: '数据', children: <StatsTab /> },
        ]}
      />
    </main>
  )
}

/* ---------------- 卡片管理 ---------------- */

function CardsTab() {
  const [books, setBooks] = useState<AdminBook[]>([])
  const [editing, setEditing] = useState<AdminCard | null>(null)
  const [creatingIn, setCreatingIn] = useState<{ chapterId: string; chapterTitle: string } | null>(null)

  const reload = useCallback(() => {
    fetch('/api/admin/cards')
      .then((r) => (r.ok ? r.json() : { books: [] }))
      .then((d) => setBooks(d.books))
  }, [])
  useEffect(reload, [reload])

  const columns: ColumnsType<AdminCard> = [
    { title: '#', dataIndex: 'idx', width: 56 },
    { title: '卡名', dataIndex: 'title', width: 180 },
    { title: '定义', dataIndex: 'definition', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: AdminCard['status']) =>
        s === 'APPROVED' ? <Tag color="green">APPROVED</Tag> : <Tag color="gold">DRAFT</Tag>,
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

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {books.map((b) => (
        <Card key={b.id} title={`${b.title} · ${b.author}`} size="small">
          <Collapse
            items={b.chapters.map((ch) => ({
              key: ch.id,
              label: `${ch.idx}. ${ch.title}`,
              extra: (
                <Button
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCreatingIn({ chapterId: ch.id, chapterTitle: ch.title })
                  }}
                >
                  + 新卡
                </Button>
              ),
              children: <Table rowKey="id" size="small" columns={columns} dataSource={ch.cards} pagination={false} />,
            }))}
          />
        </Card>
      ))}

      {editing && (
        <CardFormModal
          title={`编辑卡 #${editing.idx}`}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            await fetch('/api/admin/cards', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: editing.id, ...data }),
            })
            setEditing(null)
            reload()
          }}
        />
      )}
      {creatingIn && (
        <CardFormModal
          title={`新建卡（${creatingIn.chapterTitle}）`}
          onClose={() => setCreatingIn(null)}
          onSubmit={async (data) => {
            await fetch('/api/admin/cards', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chapterId: creatingIn.chapterId, ...data }),
            })
            setCreatingIn(null)
            reload()
          }}
        />
      )}
    </Space>
  )
}

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
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          {
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
        <Form.Item name="title" label="卡名" rules={[{ required: true, message: '请输入卡名' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="definition" label="定义（一句话命题）" rules={[{ required: true, message: '请输入定义' }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="quote" label="原文摘录">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="recast" label="重构阐释（现代人话展开）">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="trigger" label="触发问句（复习时提问用）" rules={[{ required: true, message: '请输入触发问句' }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="boundaries" label="边界（每行一条，适用条件/反例）">
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

function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => {
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then(setStats)
  }, [])
  if (!stats) return <Card loading style={{ minHeight: 200 }} />

  const reviewColumns: ColumnsType<Stats['recentReviews'][number]> = [
    {
      title: '时间',
      dataIndex: 'reviewedAt',
      width: 170,
      render: (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '—'),
    },
    { title: '卡片', dataIndex: 'title', ellipsis: true },
    {
      title: '结论',
      dataIndex: 'tier',
      width: 100,
      render: (t: number | null) => (t != null ? TIER_LABEL[t] : '—'),
    },
    {
      title: '评分',
      dataIndex: 'score',
      width: 80,
      render: (s: number | null) => (s != null ? `${s} 分` : '—'),
    },
  ]

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="用户" value={stats.users} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="上架卡片" value={stats.cards.approved} suffix={`/ ${stats.cards.total}`} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              含 {stats.cards.draft} 张草稿
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="完成复习" value={stats.reviewedCount} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="平均评分（10 分制）" value={stats.averageScore} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="最近复习">
        <Table rowKey="id" size="small" columns={reviewColumns} dataSource={stats.recentReviews} pagination={false} />
      </Card>
    </Space>
  )
}
