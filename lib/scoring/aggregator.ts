/**
 * 评分聚合器 — 纯函数，无副作用
 *
 * 输入：每家公司的维度分数（来自 scoreOne）
 * 输出：加权总分 + 雷达图数据 + 强弱维度
 */
import { DIMENSION_WEIGHTS, type AggregatedReport, type ScoreOutput } from './dimensions';
import type { InterviewerType, Dimension } from '../agents/interviewer/types';

export interface AggregateInput {
  company: InterviewerType;
  /** key: dimension name, value: ScoreOutput */
  scores: Record<string, ScoreOutput>;
}

const DEFAULT_SCORE = 60; // 评分失败兜底

export function aggregate(input: AggregateInput): AggregatedReport {
  const weights = DIMENSION_WEIGHTS[input.company];

  // 1. 雷达图：每个维度的分数（缺失维度用默认值）
  const radar: Record<string, number> = {};
  const used: Record<string, number> = {};

  for (const [dim, w] of Object.entries(weights) as Array<[Dimension, number]>) {
    if (w <= 0) continue;
    const s = input.scores[dim];
    const score = s ? s.score : DEFAULT_SCORE;
    radar[dim] = score;
    // Bug-006 修复：只有实际传入 score 的维度才进总分加权
    // 否则 fallback 60 分会被算进分子，但分母只算传入的维度权重 → 稀释成高分
    if (s) used[dim] = score * w;
  }

  // 2. 总分 = 加权求和
  // 分子：实际评分的维度 × 其权重之和
  // 分母：实际启用（权重大于 0）的维度权重之和（用于归一化）
  const usedWeightSum = (Object.entries(weights) as Array<[Dimension, number]>)
    .filter(([d, w]) => w > 0 && input.scores[d])
    .reduce((sum, [, w]) => sum + w, 0);

  const weightedSum = Object.entries(used).reduce((sum, [, v]) => sum + v, 0);
  const totalScore = usedWeightSum > 0 ? Math.round(weightedSum / usedWeightSum) : DEFAULT_SCORE;

  // 3. 强弱维度排序
  const sorted = (Object.entries(radar) as Array<[string, number]>).sort((a, b) => b[1] - a[1]);
  const strong = sorted.slice(0, 2).map(([d]) => d);
  const weak = sorted
    .slice(-2)
    .reverse()
    .map(([d]) => d);

  // 4. summary：模板
  const summary = `总分 ${totalScore}。强项：${strong.join('、')}；弱项：${weak.join('、')}。`;

  return {
    totalScore,
    radar,
    weak,
    strong,
    summary,
  };
}
