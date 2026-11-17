import type { ThemeConfig } from 'antd'

/** 管理台统一主题 —— 按 Ant Design 视觉规范：中性色文字分层、8n 间距、轻圆角 */
export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 8,
    colorBgLayout: '#f5f6fa',
  },
  components: {
    Card: { borderRadiusLG: 12 },
    Table: { headerBg: '#fafafa' },
  },
}
