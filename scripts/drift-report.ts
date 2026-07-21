/**
 * 评分漂移监控报告生成器
 *
 * 流程：
 *   1. 查询最近 N 小时的 AnchorEvaluation（默认 24h）
 *   2. 按 (company, dimension, agentName) 聚合
 *   3. 计算 driftRate / avgDelta / maxDelta
 *   4. 与阈值比较，写入 AnchorDriftAlert（如未存在）
 *   5. 输出 markdown 报告到 stdout
 *
 * 用法：
 *   pnpm tsx scripts/drift-report.ts              # 最近 24h
 *   pnpm tsx scripts/drift-report.ts --hours=1    # 最近 1h
 *   pnpm tsx scripts/drift-report.ts --hours=168  # 最近 7 天
 *
 * 阈值（与 anchor-vs-ai.ts 一致）：
 *   - driftRate > 30% → HIGH
 *   - driftRate > 15% → MEDIUM
 *   - 其他           → LOW
 *
 * Why this exists:
 *   - T3.5 — 没有"看得见的报告"= 没有反馈环
 *   - 每周 prod 跑一次 anchor-vs-ai.ts + drift-report.ts
 *   - 报告贴到周会，PM/QA 决定是否 review prompt
 */
import { prisma } from '../lib/db/client';

interface Args {
  hours: number;
  company?: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { hours: 24, dryRun: false };
  for (const arg of args) {
    if (arg.startsWith('--hours=')) out.hours = parseInt(arg.slice(8), 10) || 24;
    else if (arg.startsWith('--company=')) out.company = arg.slice(10);
    else if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

function severity(driftRate: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (driftRate > 0.3) return 'HIGH';
  if (driftRate > 0.15) return 'MEDIUM';
  return 'LOW';
}

async function main() {
  const args = parseArgs();
  const now = new Date();
  const windowStart = new Date(now.getTime() - args.hours * 60 * 60 * 1000);

  console.info(`[drift-report] 窗口: ${windowStart.toISOString()} → ${now.toISOString()}`);

  // 查询窗口内所有 evaluation
  const where: Record<string, unknown> = {
    evaluatedAt: { gte: windowStart },
  };
  if (args.company) {
    where.anchor = { company: args.company };
  }

  let evaluations: Array<{
    id: string;
    anchorId: string;
    agentName: string;
    agentVersion: string;
    aiScore: number;
    driftDelta: number;
    isDrift: boolean;
    aiReasoning: string | null;
    durationMs: number;
    evaluatedAt: Date;
    anchor: { company: string; dimension: string };
  }>;
  try {
    evaluations = await prisma.anchorEvaluation.findMany({
      where,
      include: {
        anchor: { select: { company: true, dimension: true } },
      },
      orderBy: { evaluatedAt: 'asc' },
    });
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    console.error(`[drift-report] ❌ DB 不可达: ${msg}`);
    console.error(
      '[drift-report] 修复路径:\n' +
        '  1. 检查 .env.local 里 DATABASE_URL 是否正确\n' +
        '  2. 确认 DB 服务可达\n' +
        '  3. 应用 anchor migration: pnpm prisma migrate deploy\n' +
        '  4. 先跑一次: pnpm tsx scripts/anchor-vs-ai.ts --sample=5'
    );
    process.exit(2);
  }

  console.info(`[drift-report] 窗口内 evaluation 数: ${evaluations.length}`);

  if (evaluations.length === 0) {
    console.info('[drift-report] 无数据，结束');
    return;
  }

  // 按 (company, dimension, agentName) 聚合
  type Group = {
    company: string;
    dimension: string;
    agentName: string;
    sampleCount: number;
    driftCount: number;
    driftRate: number;
    totalDelta: number;
    maxDelta: number;
    evaluations: typeof evaluations;
  };

  const groupMap = new Map<string, Group>();
  for (const e of evaluations) {
    const key = `${e.anchor.company}|${e.anchor.dimension}|${e.agentName}`;
    let g = groupMap.get(key);
    if (!g) {
      g = {
        company: e.anchor.company,
        dimension: e.anchor.dimension,
        agentName: e.agentName,
        sampleCount: 0,
        driftCount: 0,
        driftRate: 0,
        totalDelta: 0,
        maxDelta: 0,
        evaluations: [],
      };
      groupMap.set(key, g);
    }
    g.sampleCount++;
    if (e.isDrift) g.driftCount++;
    g.totalDelta += e.driftDelta;
    if (e.driftDelta > g.maxDelta) g.maxDelta = e.driftDelta;
    g.evaluations.push(e);
  }

  // 计算 driftRate + avgDelta
  const groups = Array.from(groupMap.values()).map((g) => ({
    ...g,
    driftRate: g.driftCount / g.sampleCount,
    avgDelta: g.totalDelta / g.sampleCount,
    severity: severity(g.driftCount / g.sampleCount),
  }));

  // 按 severity 降序排序（HIGH 在前）
  groups.sort((a, b) => {
    const sevOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (sevOrder[a.severity] !== sevOrder[b.severity]) {
      return sevOrder[a.severity] - sevOrder[b.severity];
    }
    return b.driftRate - a.driftRate;
  });

  // 输出 markdown 报告
  console.info('');
  console.info('# 评分漂移监控报告');
  console.info('');
  console.info(`- 窗口: 最近 ${args.hours}h`);
  console.info(`- 总样本: ${evaluations.length}`);
  console.info(`- 分组: ${groups.length}`);
  console.info('');
  console.info('| 公司 | 维度 | Agent | 样本 | 漂移 | 漂移率 | 平均Δ | 最大Δ | 严重度 |');
  console.info('|------|------|-------|------|------|--------|--------|--------|--------|');
  for (const g of groups) {
    console.info(
      `| ${g.company} | ${g.dimension} | ${g.agentName} | ${g.sampleCount} | ${g.driftCount} | ${(g.driftRate * 100).toFixed(1)}% | ${g.avgDelta.toFixed(1)} | ${g.maxDelta} | ${g.severity} |`
    );
  }

  // 高严重度详情
  const highSeverity = groups.filter((g) => g.severity === 'HIGH');
  if (highSeverity.length > 0) {
    console.info('');
    console.info('## 🚨 HIGH 严重度详情');
    for (const g of highSeverity) {
      console.info('');
      console.info(`### ${g.company}/${g.dimension}/${g.agentName}`);
      console.info(
        `- driftRate: ${(g.driftRate * 100).toFixed(1)}%, avgΔ=${g.avgDelta.toFixed(1)}, maxΔ=${g.maxDelta}`
      );
      console.info(`- 漂移样本数: ${g.driftCount}/${g.sampleCount}`);
      // 列前 3 个最严重的
      const top = g.evaluations
        .filter((e) => e.isDrift)
        .sort((a, b) => b.driftDelta - a.driftDelta)
        .slice(0, 3);
      // 需要 anchor 的人工评分来展示对比 — 一次查所有需要的
      const topIds = top.map((e) => e.anchorId);
      const anchorMap = await prisma.scoreAnchor.findMany({
        where: { id: { in: topIds } },
        select: { id: true, humanScore: true },
      });
      const humanById = new Map(anchorMap.map((a) => [a.id, a.humanScore]));
      for (const e of top) {
        const humanScore = humanById.get(e.anchorId) ?? '?';
        console.info(
          `  - ${e.anchorId.slice(0, 12)}... aiScore=${e.aiScore} humanScore=${humanScore} Δ=${e.driftDelta}`
        );
        if (e.aiReasoning) {
          console.info(`    reasoning: ${e.aiReasoning.slice(0, 120).replace(/\n/g, ' ')}`);
        }
      }
    }
  }

  // 写告警（如未存在）
  if (!args.dryRun) {
    let newAlerts = 0;
    for (const g of groups) {
      if (g.severity === 'LOW') continue; // LOW 不写告警
      // 检查是否已存在告警（同窗口）
      const existing = await prisma.anchorDriftAlert.findFirst({
        where: {
          company: g.company,
          dimension: g.dimension,
          agentName: g.agentName,
          windowStart,
          windowEnd: now,
        },
      });
      if (existing) continue;

      await prisma.anchorDriftAlert.create({
        data: {
          company: g.company,
          dimension: g.dimension,
          agentName: g.agentName,
          windowStart,
          windowEnd: now,
          sampleCount: g.sampleCount,
          driftCount: g.driftCount,
          driftRate: g.driftRate,
          avgDelta: g.avgDelta,
          maxDelta: g.maxDelta,
          severity: g.severity,
          status: 'NEW',
        },
      });
      newAlerts++;
    }
    console.info('');
    console.info(`[drift-report] ✅ 写入 ${newAlerts} 条新告警`);
  } else {
    console.info('');
    console.info(`[drift-report] ⏭ dry-run，未写告警`);
  }
}

main()
  .catch((e) => {
    console.error('[drift-report] 💥', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
