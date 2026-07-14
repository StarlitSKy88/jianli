'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('000000');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agreed) {
      setError('请先勾选同意《用户协议》和《隐私政策》');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, verifyCode }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error?.message || '注册失败，请稍后重试');
        return;
      }
      const lr = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
        <h1 className="text-3xl font-bold text-center">注册</h1>
        <p className="text-xs text-center text-gray-400">开发模式验证码：000000</p>
        <input
          type="email"
          required
          placeholder="邮箱"
          aria-label="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          autoComplete="email"
        />
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
          placeholder="6 位验证码"
          aria-label="6 位验证码"
          aria-describedby="register-verify-help"
          value={verifyCode}
          onChange={(e) => setVerifyCode(e.target.value)}
          className="input"
        />
        <p id="register-verify-help" className="text-xs text-gray-400">
          开发模式验证码：000000
        </p>
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
