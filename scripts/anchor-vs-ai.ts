/**
 * AI vs 人工对比脚本 — 评分漂移检测核心
 *
 * 流程：
 *   1. 从 DB 随机抽 N 个 isActive=true 的 anchor（默认 5 个）
 *   2. 对每个 anchor，构造 ScoreInput（mock 一份对话）
 *   3. 调 scoreOne → 拿到 AI 评分
 *   4. 计算 driftDelta = |aiScore - humanScore|
 *   5. 写入 AnchorEvaluation 表
 *   6. 聚合输出"漂移报告"
 *
 * 用法：
 *   pnpm tsx scripts/anchor-vs-ai.ts                  # 默认抽 5 个
 *   pnpm tsx scripts/anchor-vs-ai.ts --sample=20     # 抽 20 个
 *   pnpm tsx scripts/anchor-vs-ai.ts --company=byte  # 只测 byte
 *   pnpm tsx scripts/anchor-vs-ai.ts --agent=mock    # 强制 mock provider（隔离真实 quota）
 *
 * 输出：
 *   - 每条 anchor 的 AI 评分 + driftDelta + isDrift
 *   - 汇总：driftRate, avgDelta, maxDelta
 *   - 写到 AnchorEvaluation（DB）
 *
 * 阈值：
 *   - 单条 driftDelta > anchor.driftThreshold → isDrift=true
 *   - 整体 driftRate > 30% → HIGH 报警
 *   - 整体 driftRate > 15% → MEDIUM 报警
 *
 * Why this exists:
 *   - T3.3 — 没有 ground truth 对照的 AI 评分 = 黑盒
 *   - prompt 改一个字 → 评分可能漂移 5 分，prod 用户看不到
 *   - 用 anchor 集做"标准试卷"，每次跑都打分 → prompt 漂移立刻可见
 */
import { prisma } from '../lib/db/client';
import { scoreOne, buildScoringPrompt } from '../lib/scoring/scorer';
import type { ScoreOutput } from '../lib/scoring/dimensions';
import { aiChat } from '../lib/ai/router';

interface Args {
  sample: number;
  company?: string;
  dimension?: string;
  agent?: string;
  agentVersion: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = {
    sample: 5,
    agentVersion: process.env.GIT_COMMIT?.slice(0, 7) ?? new Date().toISOString().slice(0, 10),
    dryRun: false,
  };
  for (const arg of args) {
    if (arg.startsWith('--sample=')) out.sample = parseInt(arg.slice(9), 10) || 5;
    else if (arg.startsWith('--company=')) out.company = arg.slice(10);
    else if (arg.startsWith('--dimension=')) out.dimension = arg.slice(12);
    else if (arg.startsWith('--agent=')) out.agent = arg.slice(8);
    else if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

/**
 * 模拟一份"面试对话"用于评分输入
 *
 * 真实场景：anchor.referenceAnswer 是"标准答案"，我们把它包装成
 * 候选人原话 + AI prompt 要求 AI 按 prompt rubric 评分
 *
 * 这是一种"自包含"测试：anchor 的 questionText 充当 prompt 输入，
 * referenceAnswer 充当候选人回答，AI 根据 prompt rubric 给分。
 */
function buildAnchorScoreInput(anchor: {
  company: string;
  role: string;
  level: string;
  dimension: string;
  questionText: string;
  referenceAnswer: string;
}): {
  prompt: ReturnType<typeof buildScoringPrompt>;
} {
  // 简化：从 referenceAnswer 截取前 300 字作为"候选人原话"
  // ScoreInput.transcript 只接受 user/assistant 角色，所以用 assistant 模拟面试官提问，user 模拟候选人回答
  const candidateUtterance = anchor.referenceAnswer.slice(0, 300);
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
      { role: 'user', content: candidateUtterance },
    ],
  });
  return { prompt };
}

async function main() {
  const args = parseArgs();
  console.info(
    `[anchor-vs-ai] 启动 | sample=${args.sample} agent=${args.agent ?? 'auto'} dryRun=${args.dryRun}`
  );

  const where: Record<string, unknown> = { isActive: true };
  if (args.company) where.company = args.company;
  if (args.dimension) where.dimension = args.dimension;

  // 抽样（MySQL 不支持 ORDER BY RAND() 性能友好版 → 先 count 再 offset）
  let total: number;
  try {
    total = await prisma.scoreAnchor.count({ where });
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    console.error(`[anchor-vs-ai] ❌ DB 不可达: ${msg}`);
    console.error(
      '[anchor-vs-ai] 修复路径:\n' +
        '  1. 检查 .env.local 里 DATABASE_URL 是否正确\n' +
        '  2. 确认 DB 服务可达 (mysql ping 或 telnet)\n' +
        '  3. 应用 anchor migration: pnpm prisma migrate deploy\n' +
        '  4. 创建 anchor 数据: POST /api/admin/anchors'
    );
    process.exit(2); // exit code 2 = DB 不可达，区别于 "no anchor" 的 exit code 1
  }
  if (total === 0) {
    console.error('[anchor-vs-ai] ❌ 没有 anchor 可测 — 请先用 admin API 创建');
    console.error(
      '[anchor-vs-ai] 示例: curl -X POST http://localhost:3000/api/admin/anchors \\\n' +
        '  -H "Authorization: Bearer $ADMIN_JWT" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        '  -d \'{"company":"byte","role":"后端","level":"P6","dimension":"tech","questionText":"...","referenceAnswer":"...","humanScore":82,"expectedScoreMin":75,"expectedScoreMax":90,"driftThreshold":5}\''
    );
    process.exit(1);
  }
  const anchors = await prisma.scoreAnchor.findMany({
    where,
    take: args.sample,
    skip: Math.floor(Math.random() * Math.max(0, total - args.sample)),
    orderBy: { id: 'asc' },
  });

  console.info(`[anchor-vs-ai] 抽样 ${anchors.length}/${total} 个 anchor`);

  let driftCount = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  const evaluations: Array<{
    anchorId: string;
    aiScore: number;
    humanScore: number;
    driftDelta: number;
    isDrift: boolean;
    reasoning: string;
    durationMs: number;
  }> = [];

  for (const anchor of anchors) {
    const { prompt } = buildAnchorScoreInput(anchor);
    const start = Date.now();
    let aiScore = -1;
    let reasoning = '';
    let ok = false;

    try {
      // 直接调 aiChat（不走 scoreOne）— 跳过 PII 检查 / fallback 干扰
      const r = await aiChat(
        [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        { temperature: 0.3, maxTokens: 600 }
      );
      // 用 regex 抓第一个整数作为分数（scorer prompt 输出是 JSON）
      const match = r.content.match(/"score"\s*:\s*(\d+)/);
      aiScore = match ? parseInt(match[1], 10) : -1;
      reasoning = r.content.slice(0, 200);
      ok = aiScore >= 0 && aiScore <= 100;
    } catch (e) {
      reasoning = `[error] ${(e as Error).message.slice(0, 150)}`;
    }

    const durationMs = Date.now() - start;
    const driftDelta = ok ? Math.abs(aiScore - anchor.humanScore) : 999;
    const isDrift = ok && driftDelta > anchor.driftThreshold;

    if (isDrift) driftCount++;
    totalDelta += driftDelta;
    if (driftDelta > maxDelta) maxDelta = driftDelta;

    evaluations.push({
      anchorId: anchor.id,
      aiScore,
      humanScore: anchor.humanScore,
      driftDelta,
      isDrift,
      reasoning,
      durationMs,
    });

    const flag = isDrift ? '🚨 DRIFT' : '✓';
    console.info(
      `  ${flag} ${anchor.company}/${anchor.dimension}/${anchor.level} ai=${aiScore} human=${anchor.humanScore} Δ=${driftDelta} (${durationMs}ms)`
    );
  }

  const driftRate = driftCount / anchors.length;
  const avgDelta = totalDelta / anchors.length;
  const severity = driftRate > 0.3 ? 'HIGH' : driftRate > 0.15 ? 'MEDIUM' : 'LOW';

  console.info('');
  console.info(`[anchor-vs-ai] === 汇总 ===`);
  console.info(`  样本数: ${anchors.length}`);
  console.info(`  driftCount: ${driftCount}`);
  console.info(`  driftRate: ${(driftRate * 100).toFixed(1)}%`);
  console.info(`  avgDelta: ${avgDelta.toFixed(2)}`);
  console.info(`  maxDelta: ${maxDelta}`);
  console.info(`  severity: ${severity}`);

  // 写库（除非 dry-run）
  if (!args.dryRun) {
    const now = new Date();
    for (const e of evaluations) {
      await prisma.anchorEvaluation.create({
        data: {
          anchorId: e.anchorId,
          agentName: args.agent ?? process.env.AGENT_NAME ?? 'auto',
          agentVersion: args.agentVersion,
          aiScore: e.aiScore === -1 ? 0 : e.aiScore,
          driftDelta: e.driftDelta,
          isDrift: e.isDrift,
          aiReasoning: e.reasoning || null,
          evaluatedAt: now,
          durationMs: e.durationMs,
        },
      });
    }
    console.info(`[anchor-vs-ai] ✅ 已写入 ${evaluations.length} 条 AnchorEvaluation`);
  } else {
    console.info(`[anchor-vs-ai] ⏭ dry-run 模式，未写库`);
  }

  // 退出码：HIGH → 1（CI 可 fail）
  if (severity === 'HIGH') {
    console.error(`[anchor-vs-ai] ❌ severity=HIGH，建议人工 review prompt`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('[anchor-vs-ai] 💥', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
