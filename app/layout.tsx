import type { Metadata } from 'next';
import './globals.css';
import { FeedbackWidget } from '@/app/components/FeedbackWidget';

export const metadata: Metadata = {
  title: 'Interview Buddy',
  description: 'AI 面试陪练 - 35+ 群体的真实面试模拟',
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
