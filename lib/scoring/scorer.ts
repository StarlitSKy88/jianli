/**
 * 单维度评分 Agent — 4 家公司复用
 *
 * 流程：
 *   1. 加载该公司该维度的评分 prompt（YAML front-matter + rubric body）
 *   2. 拼装 transcript + role/level 上下文
 *   3. 调 aiChat（自动兜底）
 *   4. 解析 JSON → zod 校验
 *   5. PII 黑名单
 *   6. 失败 fallback：返回 score=60 + 通用 suggestions
 */
import { aiChat } from '@/lib/ai/router';
import {
  ScoreInputSchema,
  ScoreOutputSchema,
  type ScoreInput,
  type ScoreOutput,
} from './dimensions';
import { loadScorerPrompt } from './prompt-loader';

const FALLBACK: ScoreOutput = {
  score: 60,
  evidence: 'AI 评分失败，给出兜底分数',
  suggestions: ['建议人工复盘'],
};

const PII_RE = [
  /婚否|已婚|未婚|结婚/,
  /子女|孩子|生育/,
  /是否有房|买房|房贷|房产/,
  /\d{2}\s*岁|年龄/,
];

export async function scoreOne(input: ScoreInput): Promise<ScoreOutput> {
  const parsed = ScoreInputSchema.parse(input);
  const prompt = buildScoringPrompt(parsed);

  try {
    const result = await aiChat(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      { temperature: 0.3, maxTokens: 600 }
    );
    const out = parseOutput(result.content);
    guardPII(out); // PII 红线必须 throw，且 throw 在 try 外
    return out;
  } catch (e) {
    if ((e as Error).message?.includes('PII 红线')) throw e; // PII 红线不吞
    console.warn(`[scorer] scoreOne failed: ${(e as Error).message}`);
    return FALLBACK;
  }
}

export function buildScoringPrompt(input: ScoreInput): { system: string; user: string } {
  const prompt = loadScorerPrompt(input.company, input.dimension);
  const companyUpper = input.company.toUpperCase();

  const system = `${prompt.body}

---

## 当前任务上下文
- 候选人岗位：${input.role}
- 职级：${input.level}
- 面试公司：${companyUpper}
- 评分维度：${input.dimension}
- 评分权重：${prompt.meta.weight}

## 输出严格 JSON（不要包裹代码块）
{
  "score": <0-100 整数>,
  "evidence": "<引用候选人具体原话，最多 100 字>",
  "suggestions": ["<改进建议 1>", "<改进建议 2>", "..."]
}`;

  const transcriptText = input.transcript
    .map((m) => `${m.role === 'user' ? '候选人' : '面试官'}: ${m.content}`)
    .join('\n');

  const user = `请对以下对话中的"${input.dimension}"维度打分：\n\n${transcriptText}`;

  return { system, user };
}

function parseOutput(raw: string): ScoreOutput {
  // 尝试 1：直接 JSON
  try {
    return ScoreOutputSchema.parse(JSON.parse(raw));
  } catch {
    // ignore
  }
  // 尝试 2：提取 ```json ... ```
  const m = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (m) {
    try {
      return ScoreOutputSchema.parse(JSON.parse(m[1]));
    } catch {
      // ignore
    }
  }
  // 失败兜底
  console.warn(`[scorer] 输出非 JSON: ${raw.slice(0, 80)}`);
  return FALLBACK;
}

function guardPII(out: ScoreOutput): void {
  const text = `${out.evidence} ${out.suggestions.join(' ')}`;
  for (const re of PII_RE) {
    if (re.test(text)) {
      throw new Error(`[scorer] PII 红线拦截: ${text.slice(0, 50)}`);
    }
  }
}
