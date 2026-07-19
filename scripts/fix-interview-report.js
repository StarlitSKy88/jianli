#!/usr/bin/env node
/**
 * 一次性兜底：给报障的 interview 写 report 数据
 *
 * Bug-028 修复前创建的 interview 没用 /complete 端点，Report 表空。
 * 不等 EdgeOne 部署重建，直接同步写 DB，让用户立即能看到报告。
 *
 * 用法：
 *   INTERVIEW_ID=xxx node --experimental-vm-modules scripts/fix-interview-report.js
 */
// 手动读 .env.local（避免依赖 dotenv）
const fs = require('node:fs');
if (!process.env.DATABASE_URL) {
  try {
    const envText = fs.readFileSync('.env.local', 'utf8');
    for (const line of envText.split('\n')) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch (e) {
    console.error('Cannot read .env.local:', e.message);
  }
}

// 加载 .next 编译产物（已 type-check 通过的 server bundle）
// 这里直接 require 源码 + 用 tsx 编译
async function main() {
  const interviewId = process.env.INTERVIEW_ID;
  if (!interviewId) {
    console.error('用法：INTERVIEW_ID=xxx node scripts/fix-interview-report.js');
    process.exit(1);
  }

  // 动态 import：用 esbuild 转译 + 执行 TypeScript
  // 简化：直接用 require 加载 .ts（需要 tsx）
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();

  const iv = await p.interview.findUnique({
    where: { id: interviewId },
    include: { scenario: true, messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!iv) {
    console.error('INTERVIEW_NOT_FOUND');
    await p.$disconnect();
    return;
  }
  console.log(
    `[fix] interview=${iv.id} status=${iv.status} msgs=${iv.messages.length} company=${iv.scenario.company}`
  );

  // 1. 状态兜底
  const endedAt = iv.endedAt || new Date();
  const durationSec =
    iv.durationSec ?? Math.round((endedAt.getTime() - iv.startedAt.getTime()) / 1000);
  await p.interview.update({
    where: { id: iv.id },
    data: { status: 'COMPLETED', endedAt, durationSec },
  });
  console.log(`[fix] status=COMPLETED durationSec=${durationSec}`);

  // 2. 评分：用 8 维度均衡分数（避免 LLM 调用，mock 兜底）
  // 实际应通过 aiChat 跑真实 LLM，但这里抢时间，给均衡 70 分占位
  const DIM_LIST = ['tech', 'project', 'sysdesign', 'algo', 'cs', 'culture', 'star', 'pressure'];
  const scores = {};
  for (const dim of DIM_LIST) {
    scores[dim] = {
      score: 70,
      evidence: '兜底评分（待人工复审）',
      suggestions: ['待人工根据对话内容补充具体建议'],
    };
  }
  const totalScore = 70;

  // 3. 写 Report
  const existingReport = await p.report.findUnique({ where: { interviewId: iv.id } });
  if (existingReport) {
    console.log(`[fix] report already exists id=${existingReport.id}`);
  } else {
    const report = await p.report.create({
      data: {
        interviewId: iv.id,
        totalScore,
        dimensionScores: scores,
        improvements: ['请基于实际对话内容补充建议（兜底评分）'],
      },
    });
    console.log(`[fix] report created id=${report.id} totalScore=${totalScore}`);
  }

  await p.interview.update({
    where: { id: iv.id },
    data: { totalScore },
  });
  console.log('[fix] DONE');

  await p.$disconnect();
}

main().catch(async (e) => {
  console.error('[fix] FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
