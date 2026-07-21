/**
 * 种子数据：5 条 ScoreAnchor，覆盖 byte/ali/tencent 三家公司
 * 用于立即验证 anchor-vs-ai.ts + drift-report.ts 端到端
 */
import { prisma } from '../lib/db/client';

const ANCHORS = [
  {
    company: 'byte',
    role: '后端工程师',
    level: 'P6',
    dimension: 'tech',
    questionText: 'Redis Pipeline 和 MGET 的区别是什么？',
    referenceAnswer:
      'MGET 是单条命令一次性拉取多个 key，适合 key 数量固定且较少的场景。Pipeline 是分批执行多条命令，更灵活，支持不同长度的命令，适用于 key 数量动态增长的场景。',
    humanScore: 82,
    expectedScoreMin: 75,
    expectedScoreMax: 90,
    driftThreshold: 5,
    tags: ['hot', '高频考点', 'Redis'],
  },
  {
    company: 'byte',
    role: '后端工程师',
    level: 'P7',
    dimension: 'sysdesign',
    questionText: '设计一个支持 10w QPS 的短链服务',
    referenceAnswer:
      '需要考虑：1) 短链生成算法（hash + 自增 + base62）2) 写入路径（布隆过滤器防穿透）3) 缓存层（多级缓存 + 一致性 hash）4) 存储分片（按 shortCode 前缀分库分表）5) 限流降级',
    humanScore: 78,
    expectedScoreMin: 70,
    expectedScoreMax: 85,
    driftThreshold: 5,
    tags: ['hot', '系统设计', '高频'],
  },
  {
    company: 'ali',
    role: 'Java 开发',
    level: 'P6',
    dimension: 'project',
    questionText: '介绍一个你做过的最有挑战的项目',
    referenceAnswer:
      '应该按 STAR 法则展开：背景(Situation)、目标(Task)、行动(Action)、结果(Result)。重点突出：1) 个人贡献（不是团队贡献）2) 技术选型理由 3) 量化结果（性能/可用性/业务指标）',
    humanScore: 80,
    expectedScoreMin: 72,
    expectedScoreMax: 88,
    driftThreshold: 5,
    tags: ['star', '项目经验'],
  },
  {
    company: 'ali',
    role: '前端工程师',
    level: 'P5',
    dimension: 'culture',
    questionText: '你和同事意见不一致时怎么处理？',
    referenceAnswer:
      '应该体现：1) 先理解对方立场（不是马上反驳）2) 用数据和事实说话 3) 找到双赢方案 4) 决策后全力执行。避免：人身攻击、单方面妥协、消极执行',
    humanScore: 85,
    expectedScoreMin: 78,
    expectedScoreMax: 92,
    driftThreshold: 5,
    tags: ['culture', '协作'],
  },
  {
    company: 'tencent',
    role: '后台开发',
    level: 'T3',
    dimension: 'pressure',
    questionText: '线上突发 OOM 你怎么处理？',
    referenceAnswer:
      '1) 立刻保留现场（heap dump、jstack、GC log）2) 应急：扩容 / 重启 / 回滚 3) 定位：MAT 分析 dump 找泄漏源 4) 修复并加监控告警 5) 复盘加压测和混沌测试',
    humanScore: 70,
    expectedScoreMin: 62,
    expectedScoreMax: 78,
    driftThreshold: 5,
    tags: ['pressure', '故障处理'],
  },
];

async function main() {
  const existing = await prisma.scoreAnchor.count();
  if (existing > 0) {
    console.log(`[seed-anchors] 已存在 ${existing} 条 anchor，跳过种子`);
    const list = await prisma.scoreAnchor.findMany({
      select: { id: true, company: true, dimension: true, humanScore: true },
    });
    console.log('现有 anchor:');
    for (const a of list) {
      console.log(`  ${a.id.slice(0, 8)} ${a.company}/${a.dimension} humanScore=${a.humanScore}`);
    }
    await prisma.$disconnect();
    return;
  }

  console.log(`[seed-anchors] 准备插入 ${ANCHORS.length} 条 anchor ...`);
  for (const a of ANCHORS) {
    const created = await prisma.scoreAnchor.create({ data: a });
    console.log(
      `  ✅ ${created.id.slice(0, 8)} ${a.company}/${a.dimension} humanScore=${a.humanScore}`
    );
  }
  console.log(`\n[seed-anchors] 完成`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
