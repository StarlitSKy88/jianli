'use client';
/**
 * FeedbackWidget — 全站浮窗反馈入口（Phase 13.5 客服通道）
 *
 * 设计目标：
 * - 右下角悬浮按钮，不影响主阅读
 * - 点击展开抽屉式表单（不跳转新页面）
 * - 已登录用户自动关联 userId（cookie 通过 fetch 携带）
 * - 蜜罐 + Turnstile（生产）+ IP 限流（后端处理）
 * - 提交成功后：弹出 toast，5s 后自动关闭 drawer
 * - ESC 键关闭，遮罩点击关闭
 *
 * 不内嵌在 layout 的原因：
 * - layout.tsx 是 server component，本组件需 client interactivity
 * - 在 layout 内通过 <FeedbackWidget /> client component 注入即可
 */

import { useEffect, useRef, useState } from 'react';
import { HoneypotFields } from './HoneypotFields';
import { TurnstileWidget } from './TurnstileWidget';

type Category = 'BUG' | 'UX' | 'FEATURE' | 'ACCOUNT' | 'OTHER';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'BUG', label: '🐛 功能异常/BUG' },
  { value: 'UX', label: '🎨 使用体验建议' },
  { value: 'FEATURE', label: '💡 功能请求' },
  { value: 'ACCOUNT', label: '👤 账户/账单' },
  { value: 'OTHER', label: '💬 其他' },
];

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<'idle' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // form state
  const [category, setCategory] = useState<Category>('BUG');
  const [content, setContent] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting]);

  // 抽屉打开时锁滚动
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDone('idle');
    setErrMsg('');

    if (content.trim().length < 5) {
      setDone('err');
      setErrMsg('反馈内容至少 5 字');
      return;
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setDone('err');
      setErrMsg('邮箱格式无效');
      return;
    }

    setSubmitting(true);
    try {
      // 读取蜜罐字段
      const formData = new FormData(e.currentTarget);
      const body: Record<string, unknown> = {
        category,
        content: content.trim(),
        contactEmail: contactEmail || null,
        turnstileToken,
        website: formData.get('website') ?? '',
        company_name: formData.get('company_name') ?? '',
        phone_number: formData.get('phone_number') ?? '',
      };

      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setDone('err');
        setErrMsg(d?.error?.message ?? `提交失败（${r.status}）`);
        return;
      }
      setDone('ok');
      setContent('');
      setContactEmail('');
      // 5s 后关闭
      setTimeout(() => {
        setOpen(false);
        setDone('idle');
      }, 5000);
    } catch (err) {
      setDone('err');
      setErrMsg('网络异常，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        type="button"
        aria-label="反馈与帮助"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: '20px',
          bottom: '20px',
          zIndex: 50,
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: '#2563eb',
          color: '#fff',
          fontSize: '22px',
          border: 'none',
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        }}
      >
        💬
      </button>

      {/* 抽屉 */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
          onClick={(e) => {
            // 遮罩点击关闭（content 内不响应）
            if (e.target === e.currentTarget && !submitting) {
              setOpen(false);
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            ref={drawerRef}
            style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '24px',
              width: '100%',
              maxWidth: '460px',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h2 id="feedback-title" style={{ margin: 0, fontSize: '18px', color: '#1a1a1a' }}>
                反馈与帮助
              </h2>
              <button
                type="button"
                onClick={() => !submitting && setOpen(false)}
                aria-label="关闭"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#666',
                  padding: '4px 8px',
                }}
              >
                ×
              </button>
            </div>

            {done === 'ok' ? (
              <div
                style={{
                  padding: '24px 0',
                  textAlign: 'center',
                  color: '#10b981',
                }}
              >
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
                <p style={{ margin: 0, fontSize: '15px' }}>反馈已收到，感谢您！</p>
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#6b7280' }}>
                  3 秒后自动关闭
                </p>
              </div>
            ) : (
              <form onSubmit={onSubmit}>
                <HoneypotFields />

                <div style={{ marginBottom: '14px' }}>
                  <label
                    htmlFor="fb-category"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      marginBottom: '6px',
                      color: '#374151',
                    }}
                  >
                    反馈类型
                  </label>
                  <select
                    id="fb-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                    }}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label
                    htmlFor="fb-content"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      marginBottom: '6px',
                      color: '#374151',
                    }}
                  >
                    详细描述 <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <textarea
                    id="fb-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={submitting}
                    rows={5}
                    maxLength={2000}
                    placeholder="请描述遇到的问题或建议...（至少 5 字）"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#9ca3af',
                      textAlign: 'right',
                      marginTop: '2px',
                    }}
                  >
                    {content.length} / 2000
                  </div>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label
                    htmlFor="fb-email"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      marginBottom: '6px',
                      color: '#374151',
                    }}
                  >
                    联系邮箱{' '}
                    <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>
                      (选填 · 用于回复)
                    </span>
                  </label>
                  <input
                    id="fb-email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    disabled={submitting}
                    placeholder="you@example.com"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                    }}
                  />
                </div>

                {process.env.NODE_ENV === 'production' && (
                  <div style={{ marginBottom: '14px' }}>
                    <TurnstileWidget
                      onSuccess={setTurnstileToken}
                      onError={() => setTurnstileToken('')}
                      onExpire={() => setTurnstileToken('')}
                    />
                  </div>
                )}

                {done === 'err' && (
                  <div
                    role="alert"
                    style={{
                      padding: '10px',
                      marginBottom: '12px',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '6px',
                      color: '#991b1b',
                      fontSize: '13px',
                    }}
                  >
                    {errMsg}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    style={{
                      padding: '8px 18px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      background: '#fff',
                      color: '#374151',
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || content.trim().length < 5}
                    style={{
                      padding: '8px 18px',
                      border: 'none',
                      borderRadius: '6px',
                      background: submitting || content.trim().length < 5 ? '#9ca3af' : '#2563eb',
                      color: '#fff',
                      cursor: submitting || content.trim().length < 5 ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 500,
                    }}
                  >
                    {submitting ? '提交中…' : '提交反馈'}
                  </button>
                </div>

                <p
                  style={{
                    fontSize: '11px',
                    color: '#9ca3af',
                    marginTop: '12px',
                    marginBottom: 0,
                    textAlign: 'center',
                  }}
                >
                  也可邮件直接联系我们：support@taomyst.top
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
