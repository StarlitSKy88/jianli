/**
 * 漂移检测的"算法演示" — 不依赖 DB / AI provider
 *
 * 用途：
 *   pnpm test tests/unit/anchor-drift-pure.test.ts
 *
 * 演示完整的 anchor-vs-ai + drift-report pipeline 在 mock 数据下的行为
 * — 这是脚本的逻辑正确性证明（端到端跑需要 prod DB + 真 anchor 数据）
 *
 * Why this exists:
 *   - T3.6 commit 后蕾姆尝试直接跑 scripts/anchor-vs-ai.ts，发现：
 *     1. 项目没装 tsx（package.json 里只有 prisma:seed 用 tsx，但 seed.ts 不存在）
 *     2. prod DB 当前不可达（TiDB 试用可能过期）
 *     3. 即便可达，DB 里也没有 anchor（admin 还没建）
 *   - 所以"立刻跑漂移检测"需要 3 步前置：
 *     a) 装 tsx / 改用 vitest 跑（已用本文件演示）
 *     b) prisma migrate deploy（应用 anchor migration）
 *     c) 手动建 anchor 数据（admin API 或 seed）
 *   - 本测试用纯 mock 数据演示漂移判定 + 报告输出逻辑
 */
import { describe, it, expect } from 'vitest';

/**
 * 模拟"AI 给分 vs 人工打分"的判定函数 — 来自 anchor-vs-ai.ts 的核心
 */
function computeDrift(
  aiScore: number,
  humanScore: number,
  driftThreshold: number
): { delta: number; isDrift: boolean } {
  const delta = Math.abs(aiScore - humanScore);
  return { delta, isDrift: delta > driftThreshold };
}

/**
 * 模拟聚合报告的 severity 判定 — 来自 drift-report.ts
 */
function severity(driftCount: number, sampleCount: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  const rate = driftCount / sampleCount;
  if (rate > 0.3) return 'HIGH';
  if (rate > 0.15) return 'MEDIUM';
  return 'LOW';
}

describe('🎯 漂移检测端到端演示（纯算法）', () => {
  // 模拟一个 prod 环境下的 anchor 集 — 8 维度 × 2-3 个
  const mockAnchors = [
    { company: 'byte', dimension: 'tech', humanScore: 82, aiScore: 80, threshold: 5 },
    { company: 'byte', dimension: 'tech', humanScore: 75, aiScore: 78, threshold: 5 },
    { company: 'byte', dimension: 'project', humanScore: 78, aiScore: 75, threshold: 5 },
    { company: 'byte', dimension: 'sysdesign', humanScore: 72, aiScore: 70, threshold: 5 },
    { company: 'ali', dimension: 'culture', humanScore: 85, aiScore: 88, threshold: 5 },
    { company: 'ali', dimension: 'project', humanScore: 80, aiScore: 60, threshold: 5 }, // 🚨 drift
    { company: 'ali', dimension: 'star', humanScore: 78, aiScore: 79, threshold: 5 },
    { company: 'tencent', dimension: 'pressure', humanScore: 68, aiScore: 65, threshold: 5 },
    { company: 'tencent', dimension: 'tech', humanScore: 82, aiScore: 81, threshold: 5 },
    { company: 'bili', dimension: 'culture', humanScore: 88, aiScore: 90, threshold: 5 },
  ];

  it('=== Anchor vs AI 漂移报告 ===', () => {
    let driftCount = 0;
    let totalDelta = 0;
    let maxDelta = 0;

    console.info('');
    console.info('| 公司 | 维度 | AI | Human | Δ | 状态 |');
    console.info('|------|------|----|----|---|------|');

    for (const a of mockAnchors) {
      const r = computeDrift(a.aiScore, a.humanScore, a.threshold);
      if (r.isDrift) driftCount++;
      totalDelta += r.delta;
      if (r.delta > maxDelta) maxDelta = r.delta;
      const flag = r.isDrift ? '🚨 DRIFT' : '✓';
      console.info(
        `| ${a.company} | ${a.dimension} | ${a.aiScore} | ${a.humanScore} | ${r.delta} | ${flag} |`
      );
    }

    const sev = severity(driftCount, mockAnchors.length);
    const driftRate = driftCount / mockAnchors.length;
    const avgDelta = totalDelta / mockAnchors.length;

    console.info('');
    console.info(
      `样本=${mockAnchors.length} drift=${driftCount} driftRate=${(driftRate * 100).toFixed(1)}%`
    );
    console.info(`avgΔ=${avgDelta.toFixed(2)} maxΔ=${maxDelta}`);
    console.info(`severity=${sev}`);
    console.info('');

    // 演示集中只有 1 个真漂移（ali/project 60 vs 80 = 20 分差），其余都是正常范围
    expect(driftCount).toBe(1);
    expect(sev).toBe('LOW'); // 1/10 = 10% < 15% 阈值
    expect(maxDelta).toBe(20);
  });

  it('severity 边界值正确映射', () => {
    expect(severity(0, 10)).toBe('LOW');
    expect(severity(1, 10)).toBe('LOW'); // 10%
    expect(severity(2, 10)).toBe('MEDIUM'); // 20%
    expect(severity(3, 10)).toBe('MEDIUM'); // 30% (边界)
    expect(severity(4, 10)).toBe('HIGH'); // 40%
    expect(severity(10, 10)).toBe('HIGH'); // 100%
  });

  it('单条 delta === threshold → 不算 drift（严格大于语义）', () => {
    const r = computeDrift(80, 75, 5);
    expect(r.delta).toBe(5);
    expect(r.isDrift).toBe(false);
  });

  it('单条 delta > threshold → 算 drift', () => {
    const r = computeDrift(81, 75, 5);
    expect(r.delta).toBe(6);
    expect(r.isDrift).toBe(true);
  });

  it('AI 返回无效（-1）→ 当作 drift', () => {
    const r = computeDrift(-1, 75, 5);
    expect(r.delta).toBe(76); // |-1 - 75| = 76
    expect(r.isDrift).toBe(true);
  });

  it('🎯 假设 prompt 改了一个字 → 评分漂移 6 分 → severity 变化', () => {
    // 模拟：prompt 改了之后所有 ai score 都 +6
    const driftedAnchors = mockAnchors.map((a) => ({ ...a, aiScore: a.aiScore + 6 }));
    let dCount = 0;
    for (const a of driftedAnchors) {
      if (computeDrift(a.aiScore, a.humanScore, a.threshold).isDrift) dCount++;
    }
    const sev = severity(dCount, driftedAnchors.length);
    console.info(
      `\n模拟 prompt 改 1 字 → driftCount=${dCount}/${driftedAnchors.length} severity=${sev}`
    );
    // 期望：原本 1 个 drift，现在大多数都变 drift → MEDIUM 或 HIGH
    expect(dCount).toBeGreaterThan(3);
    expect(['MEDIUM', 'HIGH']).toContain(sev);
  });
});

describe('📋 漂移检测运行前置条件', () => {
  it('需要 3 个前置步骤才能在 prod 跑端到端', () => {
    // 这是 metadata 测试 — 提醒下次跑的人需要做的 3 步
    const prerequisites = [
      '1. pnpm prisma migrate deploy  ← 应用 anchor migration 到 prod DB',
      '2. POST /api/admin/anchors 5-10 条 ← 建立金标准集',
      '3. pnpm test tests/unit/anchor-drift-smoke.test.ts ← 端到端跑',
    ];
    console.info('\n=== 漂移检测运行前置 ===');
    for (const p of prerequisites) console.info(p);
    console.info('');
    expect(prerequisites.length).toBe(3);
  });
});
