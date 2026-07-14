/**
 * AI 辅助提取简历结构化字段
 *
 * 入参：解析后的 rawText
 * 出参：{ name, email, phone, yearsOfExperience, skills, projects }
 */
import { aiChat } from '@/lib/ai/router';
import { z } from 'zod';

export const ExtractedResumeSchema = z.object({
  name: z.string().max(50).default(''),
  email: z.string().email().or(z.literal('')).default(''),
  phone: z.string().max(30).default(''),
  yearsOfExperience: z.number().int().min(0).max(60).default(0),
  skills: z.array(z.string().max(30)).max(30).default([]),
  projects: z
    .array(
      z.object({
        name: z.string().max(80),
        duration: z.string().max(40).default(''),
        description: z.string().max(500).default(''),
        techStack: z.array(z.string().max(30)).max(15).default([]),
      })
    )
    .max(10)
    .default([]),
});

export type ExtractedResume = z.infer<typeof ExtractedResumeSchema>;

const FALLBACK: ExtractedResume = {
  name: '',
  email: '',
  phone: '',
  yearsOfExperience: 0,
  skills: [],
  projects: [],
};

export async function extractStructured(rawText: string): Promise<ExtractedResume> {
  if (!rawText.trim()) return FALLBACK;

  const system = `你是一个简历解析助手。从候选人简历文本中提取结构化信息。

## 严禁询问或输出
- 婚否 / 子女 / 是否有房 / 年龄
- 与岗位能力无关的 PII

## 输出严格 JSON（不要包裹代码块）
{
  "name": "<姓名，无则空串>",
  "email": "<邮箱，无则空串>",
  "phone": "<电话，无则空串>",
  "yearsOfExperience": <工作年限整数，无则 0>,
  "skills": ["<技能1>", "<技能2>", "..."],
  "projects": [
    {
      "name": "<项目名>",
      "duration": "<时间段，如 2023-2025>",
      "description": "<100 字内简介>",
      "techStack": ["<技术栈>", "..."]
    }
  ]
}`;

  const user = `请解析以下简历：\n\n${rawText.slice(0, 6000)}`; // 截断避免超长

  try {
    const result = await aiChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.2, maxTokens: 2000 }
    );

    let json: unknown;
    try {
      json = JSON.parse(result.content);
    } catch {
      const m = result.content.match(/```(?:json)?\s*([\s\S]+?)```/);
      if (m) json = JSON.parse(m[1]);
      else throw new Error('AI 输出非 JSON');
    }

    return ExtractedResumeSchema.parse(json);
  } catch (e) {
    console.warn(`[ai-extract] 失败，回退: ${(e as Error).message}`);
    return FALLBACK;
  }
}
