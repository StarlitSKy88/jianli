/**
 * 评分维度定义 — 每家公司独立权重
 *
 * 来源：PRD §5.5 多 Agent 评分（4 公司各自独立 5/6 维）
 */
import { z } from 'zod';
import type { InterviewerType, Dimension } from '../agents/interviewer/types';

/** 单家公司的维度权重（和必须等于 1.0） */
export const DIMENSION_WEIGHTS: Record<InterviewerType, Record<Dimension, number>> = {
  byte: {
    algo: 0.3,
    cs: 0.2,
    project: 0.25,
    sysdesign: 0.15,
    culture: 0.1,
    star: 0,
    pressure: 0,
    tech: 0, // byte 不用通用 tech 维度，拆成 algo+cs
  },
  ali: {
    culture: 0.3,
    project: 0.3,
    star: 0.2,
    tech: 0.15,
    sysdesign: 0.05,
    algo: 0,
    cs: 0,
    pressure: 0,
  },
  tencent: {
    pressure: 0.25,
    project: 0.3,
    star: 0.2,
    tech: 0.15,
    culture: 0.1,
    algo: 0,
    cs: 0,
    sysdesign: 0,
  },
  bili: {
    culture: 0.3,
    project: 0.25,
    tech: 0.2,
    star: 0.15,
    sysdesign: 0.1,
    algo: 0,
    cs: 0,
    pressure: 0,
  },
};

/**
 * 0-100 分制
 *
 * Phase 14.25 新增置信度字段 + 追问引用机制：
 * - confidence (0-1): AI 自评对这次评分的把握度
 *   - 高 (≥0.8): AI 有明确证据支撑
 *   - 中 (0.5-0.8): 有依据但存在歧义
 *   - 低 (<0.5): 对话信息不足 / 边界情况
 * - citationQuotes: 引用的候选人原话片段（用于反幻觉校验）
 *   - 必须来自 transcript.user 的 content
 *   - 缺失 → 反幻觉门禁拒绝（fallback 60 分）
 */
export const ScoreOutputSchema = z.object({
  score: z.number().min(0).max(100),
  evidence: z.string().max(500), // 引用的具体候选人原话（向后兼容字段）
  suggestions: z.array(z.string().max(200)).max(5), // 最多 5 条改进建议
  confidence: z.number().min(0).max(1).optional(), // 置信度（Phase 14.25）
  citationQuotes: z.array(z.string().max(100)).max(3).optional(), // 引用片段（Phase 14.25）
});
export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;

export const ScoreInputSchema = z.object({
  company: z.enum(['byte', 'ali', 'tencent', 'bili']),
  role: z.string(),
  level: z.string(),
  dimension: z.enum(['tech', 'project', 'sysdesign', 'algo', 'cs', 'culture', 'star', 'pressure']),
  transcript: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
      })
    )
    .max(100), // 单维度评分最多看 100 条对话(Round 5 Bug-007:30 轮 = 60 条,50 太严)
});
export type ScoreInput = z.infer<typeof ScoreInputSchema>;

/** 聚合报告 */
export const AggregatedReportSchema = z.object({
  totalScore: z.number().min(0).max(100),
  radar: z.record(z.string(), z.number().min(0).max(100)),
  weak: z.array(z.string()).max(3),
  strong: z.array(z.string()).max(3),
  summary: z.string().max(500),
});
export type AggregatedReport = z.infer<typeof AggregatedReportSchema>;

/** 获取某家公司实际启用的维度（权重大于 0） */
export function activeDimensions(company: InterviewerType): Dimension[] {
  const weights = DIMENSION_WEIGHTS[company];
  return (Object.entries(weights) as Array<[Dimension, number]>)
    .filter(([, w]) => w > 0)
    .map(([d]) => d);
}
