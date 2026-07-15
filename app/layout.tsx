import type { Metadata } from 'next';
import './globals.css';
import { FeedbackWidget } from '@/app/components/FeedbackWidget';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://jianli.taomyst.top';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Interview Buddy - AI 面试陪练',
    template: '%s | Interview Buddy',
  },
  description: '35+ 群体的 AI 面试陪练 — 字节/阿里/腾讯/B站 16 关真实模拟，每日 3 次免费',
  keywords: [
    'AI 面试',
    '面试陪练',
    '35+ 求职',
    '模拟面试',
    '面试评估',
    '字节',
    '阿里',
    '腾讯',
    'B站',
  ],
  authors: [{ name: 'Interview Buddy' }],
  creator: 'Interview Buddy',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: BASE_URL,
    title: 'Interview Buddy - AI 面试陪练',
    description: '35+ 群体的 AI 面试陪练 — 16 关真实模拟 + 8 维度评分报告',
    siteName: 'Interview Buddy',
  },
  alternates: {
    canonical: BASE_URL,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <FeedbackWidget />
        <footer
          style={{
            borderTop: '1px solid #e5e7eb',
            padding: '1.5rem 1rem',
            textAlign: 'center',
            fontSize: '12px',
            color: '#6b7280',
            marginTop: '3rem',
          }}
        >
          <p>
            © 2026 Interview Buddy ·{' '}
            <a href="/legal/terms" style={{ color: '#6b7280', textDecoration: 'underline' }}>
              用户协议
            </a>{' '}
            ·{' '}
            <a href="/legal/privacy" style={{ color: '#6b7280', textDecoration: 'underline' }}>
              隐私政策
            </a>{' '}
            ·{' '}
            <a
              href="mailto:support@taomyst.top"
              style={{ color: '#6b7280', textDecoration: 'underline' }}
            >
              联系我们
            </a>
          </p>
          <p style={{ marginTop: '0.25rem' }}>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#6b7280', textDecoration: 'underline' }}
            >
              京ICP备2025108350号-2
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
