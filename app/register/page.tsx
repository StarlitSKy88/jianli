'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { HoneypotFields } from '@/app/components/HoneypotFields';
import { TurnstileWidget } from '@/app/components/TurnstileWidget';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Turnstile token（每次发码 / 注册时由 widget 更新）
  const [turnstileToken, setTurnstileToken] = useState<string>('');

  // 验证码发送状态
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0); // 倒计时秒数
  const [codeSentMsg, setCodeSentMsg] = useState<string | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      const r = await fetch('/api/auth/send-verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d?.error?.message || '发送失败，请稍后重试');
        return;
      }
      const hint = d?.data?.devHint ? `（${d.data.devHint}）` : '';
      setCodeSentMsg(`验证码已发送到 ${email}${hint}`);
      startCooldown(d?.data?.cooldownSec ?? 60);
    } catch {
      setError('网络错误，请检查连接');
    } finally {
      setSendingCode(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!agreed) {
      setError('请先勾选同意《用户协议》和《隐私政策》');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      // 蜜罐字段（包含在 FormData 中）
      const body = {
        email,
        password,
        verifyCode,
        turnstileToken,
        website: String(fd.get('website') ?? ''),
        company_name: String(fd.get('company_name') ?? ''),
        phone_number: String(fd.get('phone_number') ?? ''),
      };
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error?.message || '注册失败，请稍后重试');
        return;
      }
      const lr = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, turnstileToken }),
      });
      if (lr.ok) router.push('/interview/new' as never);
      else router.push('/login' as never);
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
        <h1 className="text-3xl font-bold text-center">注册</h1>
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
            aria-label="发送验证码"
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
          type="password"
          required
          minLength={8}
          maxLength={64}
          placeholder="密码（8-64 位）"
          aria-label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          autoComplete="new-password"
        />
        <input
          type="text"
          required
          minLength={6}
          maxLength={6}
          inputMode="numeric"
          pattern="[0-9]{6}"
          placeholder="6 位验证码"
          aria-label="6 位验证码"
          aria-describedby="register-verify-help"
          value={verifyCode}
          onChange={(e) => setVerifyCode(e.target.value)}
          className="input"
        />
        <p id="register-verify-help" className="text-xs text-gray-400">
          点击「获取验证码」后，请查收邮箱
        </p>
        <TurnstileWidget onSuccess={setTurnstileToken} onExpire={() => setTurnstileToken('')} />
        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1"
            required
          />
          <span>
            我已阅读并同意
            <a href="/legal/terms" className="underline mx-1">
              《用户协议》
            </a>
            和
            <a href="/legal/privacy" className="underline mx-1">
              《隐私政策》
            </a>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-red-500 text-sm">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? '注册中…' : '注册'}
        </button>
        <p className="text-sm text-center text-gray-500">
          已有账号？
          <a href="/login" className="underline">
            登录
          </a>
        </p>
      </form>
    </main>
  );
}
