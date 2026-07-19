'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResumeUploader } from '@/app/components/ResumeUploader';

const COMPANIES = [
  { id: 'byte', name: '字节跳动', emoji: '🔥', desc: '技术深度派 · 算法/计基' },
  { id: 'ali', name: '阿里巴巴', emoji: '🛍️', desc: '价值观深挖 · STAR 法则' },
  { id: 'tencent', name: '腾讯', emoji: '🐧', desc: '抗压测试 · 项目复盘' },
  { id: 'bili', name: 'B 站', emoji: '📺', desc: '场景化 · 社区文化' },
] as const;

const LEVELS = ['P5', 'P6', 'P7', 'P8'];
const ROLES = ['后端工程师', '前端工程师', '算法工程师', '产品经理', '数据分析师'];

interface Resume {
  id: string;
  name: string;
  yearsOfExperience?: number;
  parsed: { skills?: string[] };
}

export default function NewInterviewPage() {
  const router = useRouter();
  const [company, setCompany] = useState<(typeof COMPANIES)[number]['id']>('byte');
  const [level, setLevel] = useState('P6');
  const [role, setRole] = useState('后端工程师');
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/resume');
        if (r.ok) {
          const d = await r.json();
          // B12 修复：normalize 每条简历的 parsed + techStack，避免 undefined 渗入渲染
          const list = (d.resumes || []).map((row: Resume & { techStack?: string[] }) => ({
            ...row,
            parsed:
              row.parsed && typeof row.parsed === 'object' && !Array.isArray(row.parsed)
                ? row.parsed
                : {},
            techStack: Array.isArray(row.techStack) ? row.techStack : [],
          }));
          setResumes(list);
          if (list[0]) setResumeId(list[0].id);
        } else if (r.status === 401) {
          // Bug-023 (2026-07-20 E2E #7)：未登录访问 /interview/new 跳 /login
          // 与首页策略一致，避免页面被潜入但提交时被拦（用户体验差）
          router.replace('/login');
        } else {
          // B12 修复：500 等其他错误不静默吞
          console.warn(`[interview/new] /api/resume returned ${r.status}`);
        }
      } catch (e) {
        console.warn('[interview/new] /api/resume fetch failed:', (e as Error).message);
      }
    })();
  }, []);

  async function onStart() {
    if (!resumeId) {
      setError('请先上传简历');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company, role, level, resumeId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || '创建面试失败');
        return;
      }
      const { id } = await r.json();
      router.push(`/interview/${id}` as never);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">选择面试场景</h1>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">1. 简历</h2>
        {resumes.length > 0 ? (
          <div className="space-y-2">
            {resumes.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="resume"
                  checked={resumeId === r.id}
                  onChange={() => setResumeId(r.id)}
                />
                <div className="flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-gray-500">
                    {r.yearsOfExperience || 0} 年经验 ·{' '}
                    {r.parsed?.skills?.slice(0, 5).join(' / ') || '未提取技能'}
                  </div>
                </div>
              </label>
            ))}
            <details className="mt-2">
              <summary className="text-sm text-blue-500 cursor-pointer">+ 上传新简历</summary>
              <div className="mt-2">
                <ResumeUploader
                  onUploaded={(r) => {
                    setResumes((prev) => [
                      { ...r, parsed: (r.parsed as Resume['parsed']) || {} } as Resume,
                      ...prev,
                    ]);
                    setResumeId(r.id);
                  }}
                />
              </div>
            </details>
          </div>
        ) : (
          <ResumeUploader
            onUploaded={(r) => {
              setResumes((prev) => [
                { ...r, parsed: (r.parsed as Resume['parsed']) || {} } as Resume,
                ...prev,
              ]);
              setResumeId(r.id);
            }}
          />
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">2. 公司</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {COMPANIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCompany(c.id)}
              className={`p-4 rounded-lg border-2 text-left transition ${
                company === c.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-1">{c.emoji}</div>
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-gray-500 mt-1">{c.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">3. 职级</h2>
        <div className="flex gap-3">
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`px-6 py-2 rounded-full border ${
                level === l
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">4. 岗位</h2>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="input max-w-xs">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </section>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      <button
        onClick={onStart}
        disabled={loading || !resumeId}
        className="btn-primary text-lg px-12 py-3"
      >
        {loading ? '准备中…' : '开始面试'}
      </button>
    </main>
  );
}
