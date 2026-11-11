'use client'

import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { login } from '../actions'

export default function AdminLoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.set('username', values.username)
      fd.set('password', values.password)
      const res = await login({ status: 'in_progress' }, fd)
      if (res.status === 'success') {
        router.push('/admin')
        router.refresh()
      } else {
        setError('账号或口令不对')
      }
    } catch {
      setError('登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ marginTop: 0, textAlign: 'center' }}>
          一念·精读 管理台
        </Typography.Title>
        <Form onFinish={onFinish} layout="vertical" autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
            <Input placeholder="账号" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入口令' }]}>
            <Input.Password placeholder="口令" autoComplete="current-password" />
          </Form.Item>
          {error && (
            <Form.Item>
              <Alert type="error" message={error} showIcon />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" block loading={loading}>
            进入
          </Button>
        </Form>
      </Card>
    </Flex>
  )
}
