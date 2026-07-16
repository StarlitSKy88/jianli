'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { HoneypotFields } from '@/app/components/HoneypotFields';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/app/components/TurnstileWidget';

export default function ResetPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [codeSentMsg, setCodeSentMsg] = useState<string | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  function startCooldown(seconds: number) {
    setCodeCooldown(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setCodeCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function onSendCode() {
    setError(null);
    setCodeSentMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请先输入有效的邮箱');
      return;
    }
    setSendingCode(true);
    try {
      const r = await fetch('/api/auth/send-reset-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d?.error?.message || '发送失败，请稍后重试');
        return;
      }
      // 安全设计：服务端不区分"邮箱未注册"和"已发送"，前端统一显示"已发送"
      setCodeSentMsg(
        `如果 ${email} 已注册，验证码已发送${d?.data?.devHint ? `（${d.data.devHint}）` : ''}`
      );
      startCooldown(d?.data?.cooldownSec ?? 60);
      setTurnstileToken('');
      turnstileRef.current?.reset();
    } catch {
      setError('网络错误，请检查连接');
    } finally {
      setSendingCode(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!turnstileToken) {
      setError('人机验证未完成，请等待验证组件就绪后重试');
      return;
    }
    if (password !== password2) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      const body = {
        email,
        verifyCode,
        password,
        turnstileToken,
        website: String(fd.get('website') ?? ''),
        company_name: String(fd.get('company_name') ?? ''),
        phone_number: String(fd.get('phone_number') ?? ''),
      };
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error?.message || '重置失败，请稍后重试');
        return;
      }
      setDone(true);
      // 3 秒后跳到登录页
      setTimeout(() => router.push('/login' as never), 3000);
    } catch {
      setError('网络错误，请检查连接');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <HoneypotFields />
        <h1 className="text-3xl font-bold text-center">重置密码</h1>
        {done ? (
          <div className="space-y-3">
            <p role="status" className="text-green-600 text-sm">
              ✅ 密码已重置，即将跳转到登录页…
            </p>
            <button
              type="button"
              onClick={() => router.push('/login' as never)}
              className="btn-primary w-full"
            >
              立即登录
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">输入注册邮箱 → 获取验证码 → 设置新密码</p>
            <div className="flex gap-2">
              <input
                type="email"
                required
                placeholder="邮箱"
                aria-label="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input flex-1"
                autoComplete="email"
              />
              <button
                type="button"
                onClick={onSendCode}
                disabled={sendingCode || codeCooldown > 0 || !email}
                className="btn-secondary whitespace-nowrap"
                aria-label="发送重置验证码"
              >
                {sendingCode ? '发送中…' : codeCooldown > 0 ? `${codeCooldown}s` : '获取验证码'}
              </button>
            </div>
            {codeSentMsg && (
              <p role="status" className="text-xs text-green-600">
                {codeSentMsg}
              </p>
            )}
            <input
              type="text"
              required
              minLength={6}
              maxLength={6}
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="6 位验证码"
              aria-label="6 位验证码"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              className="input"
            />
            <input
              type="password"
              required
              minLength={8}
              maxLength={64}
              placeholder="新密码（8-64 位）"
              aria-label="新密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              autoComplete="new-password"
            />
            <input
              type="password"
              required
              minLength={8}
              maxLength={64}
              placeholder="再次输入新密码"
              aria-label="再次输入新密码"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="input"
              autoComplete="new-password"
            />
            <TurnstileWidget
              ref={turnstileRef}
              onSuccess={setTurnstileToken}
              onExpire={() => setTurnstileToken('')}
            />
            {error && (
              <p role="alert" className="text-red-500 text-sm">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !turnstileToken}
              className="btn-primary w-full"
              title={!turnstileToken ? '请等待人机验证完成' : undefined}
            >
              {loading ? '重置中…' : !turnstileToken ? '等待人机验证…' : '重置密码'}
            </button>
            <p className="text-sm text-center text-gray-500">
              记起密码了？
              <a href="/login" className="underline">
                返回登录
              </a>
            </p>
          </>
        )}
      </form>
    </main>
  );
}
