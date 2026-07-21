/**
 * 漂移检测脚本的 wrapper — 通过 vitest 跑（项目无独立 tsx runtime）
 *
 * 用途：
 *   pnpm test tests/anchor-drift-smoke.test.ts
 *
 * 跑完会输出：
 *   - anchor-vs-ai 等价报告（每条 anchor 的 ai vs human）
 *   - drift-report 等价聚合（driftRate / severity）
 *
 * 注意：这是 dev-time 工具，不是单测。如果 DB 里没 anchor，vitest 会 skip。
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db/client';
import { buildScoringPrompt } from '@/lib/scoring/scorer';
import { aiChat } from '@/lib/ai/router';

async function runAnchorVsAi(sample = 3): Promise<{
  evaluated: number;
  driftCount: number;
  avgDelta: number;
  maxDelta: number;
  results: Array<{
    anchorId: string;
    company: string;
    dimension: string;
    aiScore: number;
    humanScore: number;
    delta: number;
    isDrift: boolean;
  }>;
}> {
  const total = await prisma.scoreAnchor.count({ where: { isActive: true } });
  if (total === 0) {
    return { evaluated: 0, driftCount: 0, avgDelta: 0, maxDelta: 0, results: [] };
  }

  const anchors = await prisma.scoreAnchor.findMany({
    where: { isActive: true },
    take: sample,
    skip: Math.floor(Math.random() * Math.max(0, total - sample)),
  });

  let driftCount = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  const results: Array<{
    anchorId: string;
    company: string;
    dimension: string;
    aiScore: number;
    humanScore: number;
    delta: number;
    isDrift: boolean;
  }> = [];

  for (const anchor of anchors) {
    const prompt = buildScoringPrompt({
      company: anchor.company as 'byte' | 'ali' | 'tencent' | 'bili',
      dimension: anchor.dimension as
        | 'tech'
        | 'project'
        | 'sysdesign'
        | 'algo'
        | 'cs'
        | 'culture'
        | 'star'
        | 'pressure',
      role: anchor.role,
      level: anchor.level,
      transcript: [
        { role: 'assistant', content: anchor.questionText },
        { role: 'user', content: anchor.referenceAnswer.slice(0, 300) },
      ],
    });

    let aiScore = -1;
    try {
      const r = await aiChat(
        [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        { temperature: 0.3, maxTokens: 600 }
      );
      const m = r.content.match(/"score"\s*:\s*(\d+)/);
      aiScore = m ? parseInt(m[1], 10) : -1;
    } catch {
      aiScore = -1;
    }

    const ok = aiScore >= 0 && aiScore <= 100;
    const delta = ok ? Math.abs(aiScore - anchor.humanScore) : 999;
    const isDrift = ok && delta > anchor.driftThreshold;
    if (isDrift) driftCount++;
    totalDelta += delta;
    if (delta > maxDelta) maxDelta = delta;

    results.push({
      anchorId: anchor.id.slice(0, 12),
      company: anchor.company,
      dimension: anchor.dimension,
      aiScore,
      humanScore: anchor.humanScore,
      delta,
      isDrift,
    });
  }

  return {
    evaluated: anchors.length,
    driftCount,
    avgDelta: totalDelta / anchors.length,
    maxDelta,
    results,
  };
}

describe('Anchor vs AI drift detector (smoke)', () => {
  it('runs end-to-end and reports drift', { timeout: 60_000 }, async () => {
    // 探测 DB 是否可达 + 是否有 anchor
    let totalAnchors = 0;
    try {
      totalAnchors = await prisma.scoreAnchor.count({ where: { isActive: true } });
    } catch (e) {
      console.warn(`\n⚠️ DB 不可达: ${(e as Error).message.slice(0, 80)}\n`);
      return; // skip
    }

    if (totalAnchors === 0) {
      console.warn(
        `\n⚠️ DB 里没有 isActive=true 的 anchor — 跳过漂移检测\n请先用 admin API 或 seed 创建 anchor：\n` +
          `  POST /api/admin/anchors  (Authorization: Bearer <admin JWT>)\n`
      );
      return;
    }

    const r = await runAnchorVsAi(3);

    console.info('\n=== Anchor vs AI 漂移检测报告 ===\n');
    for (const row of r.results) {
      const flag = row.isDrift ? '🚨 DRIFT' : '✓';
      console.info(
        `  ${flag} ${row.company}/${row.dimension} ai=${row.aiScore} human=${row.humanScore} Δ=${row.delta}`
      );
    }
    const driftRate = r.driftCount / r.evaluated;
    const severity = driftRate > 0.3 ? 'HIGH' : driftRate > 0.15 ? 'MEDIUM' : 'LOW';
    console.info(
      `\n样本=${r.evaluated} drift=${r.driftCount} driftRate=${(driftRate * 100).toFixed(1)}% avgΔ=${r.avgDelta.toFixed(1)} maxΔ=${r.maxDelta} severity=${severity}\n`
    );

    expect(r.evaluated).toBeGreaterThan(0);
  });
});
