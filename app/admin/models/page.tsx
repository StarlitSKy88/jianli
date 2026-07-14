'use client';
import { useEffect, useState } from 'react';

interface Provider {
  id: 'minimax' | 'claude' | 'deepseek';
  enabled: boolean;
  model: string;
  baseURL: string;
  keyFingerprint: string;
  hasEnvKey: boolean;
}

export default function AdminModelsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Provider> & { apiKey?: string }>({});
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; latencyMs: number; error?: string }>
  >({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/models');
      if (!r.ok) {
        setError('无权访问或未登录');
        return;
      }
      const d = await r.json();
      setProviders(d.providers);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(p: Provider) {
    setEditing(p.id);
    setForm({ enabled: p.enabled, model: p.model, baseURL: p.baseURL });
  }

  async function save() {
    if (!editing) return;
    const r = await fetch(`/api/admin/models/${editing}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error || '保存失败');
      return;
    }
    setEditing(null);
    setForm({});
    load();
  }

  async function test(id: string) {
    setTestResult((p) => ({ ...p, [id]: { ok: false, latencyMs: 0 } }));
    const r = await fetch(`/api/admin/models/${id}/test`, { method: 'POST' });
    const d = await r.json();
    setTestResult((p) => ({ ...p, [id]: d }));
  }

  if (error) return <main className="p-8 text-red-500">{error}</main>;

  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">AI 模型管理</h1>
      <p className="text-sm text-gray-500 mb-8">
        轮换 API key、切换默认模型、临时禁用 provider。所有更改立即生效，无需重启。
      </p>

      <div className="space-y-4">
        {providers.map((p) => (
          <div key={p.id} className="card">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold">{p.id.toUpperCase()}</h2>
                  <span
                    className={`px-2 py-1 rounded text-xs ${p.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                  >
                    {p.enabled ? '已启用' : '已禁用'}
                  </span>
                  {!p.hasEnvKey && !p.keyFingerprint.includes('*') && (
                    <span className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-700">
                      未配置 key
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500 mt-2 space-y-1">
                  <div>
                    模型: <code>{p.model}</code>
                  </div>
                  <div>
                    BaseURL: <code className="text-xs">{p.baseURL}</code>
                  </div>
                  <div>
                    Key: <code>{p.keyFingerprint}</code>
                  </div>
                </div>
                {testResult[p.id] && (
                  <div
                    className={`mt-2 text-sm ${testResult[p.id].ok ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {testResult[p.id].ok
                      ? `✓ ${testResult[p.id].latencyMs}ms`
                      : `✗ ${testResult[p.id].error}`}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => test(p.id)} className="btn-secondary text-sm">
                  测试
                </button>
                <button onClick={() => startEdit(p)} className="btn-primary text-sm">
                  编辑
                </button>
              </div>
            </div>

            {editing === p.id && (
              <div className="mt-4 pt-4 border-t space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.enabled ?? false}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  />
                  <span>启用</span>
                </label>
                <input
                  type="text"
                  placeholder="模型名（如 claude-sonnet-4-5）"
                  value={form.model || ''}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="input"
                />
                <input
                  type="text"
                  placeholder="BaseURL"
                  value={form.baseURL || ''}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                  className="input"
                />
                <input
                  type="password"
                  placeholder="新 API Key（留空保持不变）"
                  value={form.apiKey || ''}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  className="input"
                />
                <div className="flex gap-2">
                  <button onClick={save} className="btn-primary text-sm">
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setEditing(null);
                      setForm({});
                    }}
                    className="btn-secondary text-sm"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 p-4 bg-blue-50 rounded text-sm text-blue-700">
        💡 <strong>使用提示</strong>：admin 邮箱通过环境变量 <code>ADMIN_EMAILS</code>{' '}
        配置（逗号分隔）。 Key 一旦保存到本页面，仅存于进程内存，重启后回到 .env 默认值。
      </div>
    </main>
  );
}
