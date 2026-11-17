'use client'

import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { Alert, Button, Card, ConfigProvider, Flex, Form, Input, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { login } from '../actions'
import { adminTheme } from '../theme'

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
    <ConfigProvider theme={adminTheme}>
      <Flex
        align="center"
        justify="center"
        style={{ minHeight: '100vh', padding: 24, background: 'linear-gradient(180deg, #eef3fb 0%, #f5f6fa 55%)' }}
      >
        <div style={{ width: 380 }}>
          <Flex align="center" gap={10} style={{ marginBottom: 28 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #4096ff, #1677ff)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: 22,
              }}
            >
              念
            </div>
            <div>
              <Typography.Text strong style={{ fontSize: 18, display: 'block' }}>
                一念·精读
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                内部管理台
              </Typography.Text>
            </div>
          </Flex>

          <Card styles={{ body: { padding: 28 } }}>
            <Form onFinish={onFinish} layout="vertical" autoComplete="off" requiredMark={false}>
              <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
                <Input
                  size="large"
                  prefix={<UserOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
                  placeholder="账号"
                  autoComplete="username"
                />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入口令' }]}>
                <Input.Password
                  size="large"
                  prefix={<LockOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
                  placeholder="口令"
                  autoComplete="current-password"
                />
              </Form.Item>
              {error && (
                <Form.Item>
                  <Alert type="error" title={error} showIcon />
                </Form.Item>
              )}
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                进入管理台
              </Button>
            </Form>
          </Card>

          <Typography.Text
            type="secondary"
            style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 12 }}
          >
            仅限运营团队使用
          </Typography.Text>
        </div>
      </Flex>
    </ConfigProvider>
  )
}
