export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold mb-4">Interview Buddy</h1>
        <p className="text-xl text-gray-600 mb-8">面向 35+ 群体的 AI 面试陪练</p>
        <p className="text-sm text-gray-400 mb-12">字节 · 阿里 · 腾讯 · B 站 — 16 关真实模拟</p>
        <div className="flex gap-4 justify-center">
          <a href="/login" className="btn-primary">
            登录
          </a>
          <a href="/register" className="btn-secondary">
            注册
          </a>
        </div>
        <div className="mt-16 text-xs text-gray-400">每日 3 次免费 · 超出 ¥9.9/次</div>
      </div>
    </main>
  );
}
