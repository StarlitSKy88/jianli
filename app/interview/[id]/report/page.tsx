'use client';
import { useEffect, useState } from 'react';

interface AgentScore {
  id: string;
  dimensionScores: Record<string, number>;
  reasoning: string;
  agentName: string;
}

interface Report {
  id: string;
  totalScore: number;
  dimensionScores: Record<string, number>;
  improvements: string[];
  agentScores: AgentScore[];
}

function scoreColor(s: number): string {
  if (s >= 80) return 'text-green-600';
  if (s >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

/** 屏幕阅读器得分等级标签（颜色之外的冗余通道） */
function scoreLabel(s: number): string {
  if (s >= 80) return '优';
  if (s >= 60) return '良';
  return '需改进';
}

function RadarChart({ data }: { data: Record<string, number> }) {
  // 5 维雷达图（纯 SVG，无依赖）
  const dims = Object.keys(data);
  if (dims.length === 0) return null;
  const cx = 150;
  const cy = 150;
  const r = 110;

  const points = dims.map((d, i) => {
    const angle = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
    const value = (data[d] ?? 0) / 100;
    return {
      dim: d,
      x: cx + r * Math.cos(angle) * value,
      y: cy + r * Math.sin(angle) * value,
      lx: cx + (r + 20) * Math.cos(angle),
      ly: cy + (r + 20) * Math.sin(angle),
    };
  });

  const polygon = points.map((p) => `${p.x},${p.y}`).join(' ');

  // a11y：SVG 加 role=img + aria-label（含具体维度得分）
  const ariaLabel = `能力雷达图：${dims.map((d) => `${d} ${data[d]} 分（${scoreLabel(data[d])}）`).join('，')}`;

  return (
    <svg
      viewBox="0 0 300 300"
      role="img"
      aria-label={ariaLabel}
      className="w-full max-w-sm mx-auto"
    >
      <title>{ariaLabel}</title>
      {/* 同心圆参考线 */}
      {[0.25, 0.5, 0.75, 1].map((p, i) => (
        <circle key={i} cx={cx} cy={cy} r={r * p} fill="none" stroke="#e5e7eb" strokeWidth="1" />
      ))}
      {/* 维度连线 */}
      {dims.map((_, i) => {
        const angle = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + r * Math.cos(angle)}
            y2={cy + r * Math.sin(angle)}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        );
      })}
      {/* 数据多边形 */}
      <polygon points={polygon} fill="rgba(59,130,246,0.2)" stroke="#3b82f6" strokeWidth="2" />
      {/* 标签 */}
      {points.map((p) => (
        <text
          key={p.dim}
          x={p.lx}
          y={p.ly}
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-xs fill-gray-700"
        >
          {p.dim}
        </text>
      ))}
    </svg>
  );
}

export default function ReportPage({ params }: { params: { id: string } }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/interview/${params.id}/report`);
        if (!r.ok) {
          // Bug-028 (2026-07-20 E2E)：根据 status code 给不同文案
          // 404 → 面试未完成 / report 未生成（用户提前跳过来或评分失败）
          // 403 → 无权查看（userId 不匹配）
          // 其他 → 通用错误
          if (r.status === 404) {
            setError('面试尚未完成，请先回到对话页点击"完成"按钮生成报告');
          } else if (r.status === 403) {
            setError('无权查看该报告');
          } else {
            const d = await r.json().catch(() => ({}));
            setError(d?.error?.message || '加载失败，请稍后重试');
          }
          return;
        }
        const d = await r.json();
        setReport(d.report);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [params.id]);

  if (error) return <main className="p-8 text-red-500">{error}</main>;
  if (!report) return <main className="p-8">加载中…</main>;

  const sortedDims = Object.entries(report.dimensionScores).sort((a, b) => b[1] - a[1]);

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">面试报告</h1>

      <div className="card mb-8">
        <div className="text-sm text-gray-500">总分</div>
        <div className="flex items-baseline gap-3">
          <span className={`text-6xl font-bold ${scoreColor(report.totalScore)}`}>
            {report.totalScore}
          </span>
          <span
            className="text-lg text-gray-500"
            role="img"
            aria-label={`分数等级：${scoreLabel(report.totalScore)}`}
          >
            {scoreLabel(report.totalScore)}
          </span>
        </div>
      </div>

      <div className="card mb-8">
        <h2 className="text-xl font-semibold mb-4">各维度表现</h2>
        <RadarChart data={report.dimensionScores} />
        <div className="grid grid-cols-2 gap-2 mt-4">
          {sortedDims.map(([d, s]) => (
            <div key={d} className="flex justify-between p-2 bg-gray-50 rounded">
              <span>{d}</span>
              <span className={`font-semibold ${scoreColor(s)}`}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card mb-8">
        <h2 className="text-xl font-semibold mb-4">改进建议</h2>
        <ul className="space-y-2">
          {(report.improvements || []).map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-blue-500">•</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-4">
        <a href="/interview/new" className="btn-primary">
          再来一次
        </a>
        <a href="/" className="btn-secondary">
          返回首页
        </a>
      </div>
    </main>
  );
}
