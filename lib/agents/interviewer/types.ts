/**
 * 面试官类型定义 — 4 家公司共用同一份代码（DRY）
 */
import { z } from 'zod';

export const InterviewerTypeSchema = z.enum(['byte', 'ali', 'tencent', 'bili']);
export type InterviewerType = z.infer<typeof InterviewerTypeSchema>;

export const DimensionSchema = z.enum([
  'tech', // 技术深度
  'project', // 项目经验
  'sysdesign', // 系统设计
  'algo', // 算法
  'cs', // 计算机基础
  'culture', // 文化 / 价值观
  'star', // STAR 复盘
  'pressure', // 抗压
]);
export type Dimension = z.infer<typeof DimensionSchema>;

/** 面试官输出 schema — 强制 AI 输出结构化（不让 LLM 控制代码） */
export const InterviewerOutputSchema = z.object({
  question: z.string().min(2).max(500),
  dimension: DimensionSchema,
  nextFocus: z.string().max(200).optional(),
  phase: z.enum(['warmup', 'deep', 'pressure', 'feedback']),
});
export type InterviewerOutput = z.infer<typeof InterviewerOutputSchema>;

export interface InterviewerContext {
  userId: string;
  scenarioId: string;
  company: InterviewerType;
  role: string; // e.g. "后端工程师"
  level: string; // e.g. "P5" / "P6" / "P7"
  resume: {
    name: string;
    yearsOfExperience: number;
    skills: string[];
    projects: Array<{
      name: string;
      duration: string;
      description: string;
      techStack: string[];
    }>;
  };
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/** 单家公司面试官的元数据（权重、口径、来源 YAML front-matter） */
export interface InterviewerMeta {
  type: InterviewerType;
  name: string;
  personality: string;
  weights: Partial<Record<Dimension, number>>;
  version: string;
}
