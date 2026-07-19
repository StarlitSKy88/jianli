/**
 * Report 持久化 — 对齐 Prisma schema
 *
 * Report: totalScore / dimensionScores (Json) / improvements (Json)
 * AgentScore: agentName / agentVersion / totalScore / dimensionScores (Json) / reasoning / durationMs
 */
import { prisma } from '@/lib/db/client';
import type { AggregatedReport, ScoreOutput } from './dimensions';

export interface PersistInput {
  interviewId: string;
  userId: string;
  company: string;
  scores: Record<string, ScoreOutput>;
  aggregated: AggregatedReport;
}

async function assertOwnership(interviewId: string, userId: string): Promise<void> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { userId: true },
  });
  if (!interview) throw new Error('interview not found');
  if (interview.userId !== userId) throw new Error('forbidden');
}

export async function saveReport(input: PersistInput): Promise<{ reportId: string }> {
  await assertOwnership(input.interviewId, input.userId);

  // 聚合 improvements = suggestions 列表（去重）
  const allSuggestions = Object.values(input.scores).flatMap((s) => s.suggestions);
  const uniqueSuggestions = Array.from(new Set(allSuggestions)).slice(0, 10);

  // 8 维度评分后写库，事务超时默认 5s 不够 → 显式提到 30s
  // Phase 14.4 修复：PrismaClientKnownRequestError: Transaction already closed
  // 根因：8 个 scoreOne 串行调用总耗时 > 5s（mock ~1s × 8 = 8s），超过 prisma.$transaction 默认 timeout
  // 解法：传 options.timeout 提到 30s（生产用真实 LLM 会更长）
  const result = await prisma.$transaction(
    async (tx) => {
      const report = await tx.report.upsert({
        where: { interviewId: input.interviewId },
        create: {
          interviewId: input.interviewId,
          totalScore: input.aggregated.totalScore,
          dimensionScores: input.aggregated.radar as object,
          improvements: uniqueSuggestions as object,
        },
        update: {
          totalScore: input.aggregated.totalScore,
          dimensionScores: input.aggregated.radar as object,
          improvements: uniqueSuggestions as object,
        },
      });

      await tx.agentScore.deleteMany({ where: { reportId: report.id } });

      await tx.agentScore.createMany({
        data: Object.entries(input.scores).map(([dimension, s]) => ({
          reportId: report.id,
          agentName: `scorer:${dimension}`,
          agentVersion: '1.0.0',
          totalScore: s.score,
          dimensionScores: { [dimension]: s.score } as object,
          reasoning: s.evidence,
          durationMs: 0,
        })),
      });

      return report;
    },
    { timeout: 30_000 }
  );

  return { reportId: result.id };
}

export async function getReport(interviewId: string, userId: string) {
  await assertOwnership(interviewId, userId);

  return prisma.report.findUnique({
    where: { interviewId },
    include: { agentScores: true },
  });
}
