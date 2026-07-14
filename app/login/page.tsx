'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        // 中文 UI：优先显示后端中文 message（i18n-x13 P0）
        setError(d?.error?.message || '登录失败，请稍后重试');
        return;
      }
      router.push('/interview/new' as never);
    } catch {
      setError('网络错误，请检查连接');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-bold text-center">登录</h1>
        <label htmlFor="login-email" className="sr-only">
          邮箱
        </label>
        <input
          id="login-email"
          type="email"
          required
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          autoComplete="email"
          aria-label="邮箱"
        />
        <label htmlFor="login-password" className="sr-only">
          密码
        </label>
        <input
          id="login-password"
          type="password"
          required
          minLength={8}
          maxLength={64}
          placeholder="密码（8-64 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          autoComplete="current-password"
          aria-label="密码"
        />
        {error && (
          <p role="alert" className="text-red-500 text-sm">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? '登录中…' : '登录'}
        </button>
        <p className="text-sm text-center text-gray-500">
          没有账号？
          <a href="/register" className="underline">
            注册
          </a>
        </p>
      </form>
    </main>
  );
}
