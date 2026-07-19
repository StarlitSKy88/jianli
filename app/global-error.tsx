'use client';

/**
 * 全局错误兜底 — 防止"Application error"红屏
 *
 * B12 修复：之前没有 global-error.tsx，client component
 * 抛未捕获错误时 Next.js 默认红屏显示 "Application error: a
 * client-side exception has occurred (see the browser console
 * for more information)."，用户体验糟且无法恢复。
 *
 * 现在拦截所有未捕获错误，渲染可读的错误卡片 + 重新加载按钮。
 *
 * 注意：global-error.tsx 必须自带 <html>/<body>，因为它替换
 * root layout（root layout 也抛错时仍能渲染）。
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/global-error
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 上报日志 / Sentry 等
    console.error('[GlobalError]', error.message, error.digest);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#0a0a0a',
          color: '#DEDBC8',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <main
          style={{
            maxWidth: 480,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 64,
              marginBottom: 16,
              opacity: 0.4,
            }}
          >
            ⚠️
          </div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 12,
              color: '#DEDBC8',
            }}
          >
            出错了，但没关系
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: '#DEDBC8',
              opacity: 0.7,
              marginBottom: 24,
            }}
          >
            页面遇到了一个意外错误。我们已记录详细堆栈，方便工程师修复。
            <br />
            点击下方按钮重试，或返回首页。
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 11,
                fontFamily: 'monospace',
                color: '#DEDBC8',
                opacity: 0.3,
                marginBottom: 24,
                wordBreak: 'break-all',
              }}
            >
              错误 ID: {error.digest}
            </p>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{
                padding: '10px 20px',
                borderRadius: 999,
                border: 'none',
                backgroundColor: '#DEDBC8',
                color: '#0a0a0a',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
            <a
              href="/"
              style={{
                padding: '10px 20px',
                borderRadius: 999,
                border: '1px solid #DEDBC8',
                backgroundColor: 'transparent',
                color: '#DEDBC8',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              返回首页
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
