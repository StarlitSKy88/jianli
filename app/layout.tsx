import type { Metadata } from 'next';
import './globals.css';
import { FeedbackWidget } from '@/app/components/FeedbackWidget';
import { Inter, Instrument_Serif } from 'next/font/google';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://jianli.taomyst.top';

// Phase 15.5: Prisma 风格字体 — Inter 全局默认（替代 Almarai，因 Almarai 只支持阿拉伯 subset）
// + Instrument Serif 斜体衬线（保留 Prisma 标志性的 italic 强调）
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

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
    // Bug-027 (2026-07-20 E2E)：补 og:image，让微信/微博/Twitter 分享时显示预览图
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Interview Buddy — 35+ AI 面试陪练',
      },
    ],
  },
  // Bug-027：补 Twitter Card（X 平台分享必备）
  twitter: {
    card: 'summary_large_image',
    title: 'Interview Buddy - AI 面试陪练',
    description: '35+ 群体的 AI 面试陪练 — 16 关真实模拟 + 8 维度评分报告',
    images: ['/og-image.png'],
  },
  // Bug-027：iOS Safari 5-set（添加到主屏 + 启动画面 + 状态栏样式）
  appleWebApp: {
    capable: true,
    title: 'Interview Buddy',
    statusBarStyle: 'black-translucent',
    // startupImage: iOS 启动画面（如需可后续追加 1242×2688 / 750×1620 等多套）
  },
  applicationName: 'Interview Buddy',
  // Bug-027：PWA / Chrome 地址栏配色
  themeColor: '#0a0a0a',
  // Bug-027：format-detection 关闭 iOS 自动识别电话/邮箱（避免误触发 tel:/mailto:）
  formatDetection: { telephone: false, email: false, address: false },
  alternates: {
    canonical: BASE_URL,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body className={inter.className}>
        {children}
        <FeedbackWidget />
        <footer
          style={{
            borderTop: '1px solid #1f1f1f',
            padding: '1.5rem 1rem',
            textAlign: 'center',
            fontSize: '12px',
            color: '#787774',
            marginTop: '0',
            backgroundColor: '#0a0a0a',
          }}
        >
          <p>
            © 2026 Interview Buddy ·{' '}
            <a href="/legal/terms" style={{ color: '#DEDBC8', textDecoration: 'underline' }}>
              用户协议
            </a>{' '}
            ·{' '}
            <a href="/legal/privacy" style={{ color: '#DEDBC8', textDecoration: 'underline' }}>
              隐私政策
            </a>{' '}
            ·{' '}
            <a
              href="mailto:support@taomyst.top"
              style={{ color: '#DEDBC8', textDecoration: 'underline' }}
            >
              联系我们
            </a>
          </p>
          <p style={{ marginTop: '0.25rem' }}>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#787774', textDecoration: 'underline' }}
            >
              京ICP备2025108350号-2
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
