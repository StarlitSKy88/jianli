/**
 * 单维度评分 Agent — 4 家公司复用
 *
 * 流程：
 *   1. 构造评分 prompt（含维度 + 公司 + transcript）
 *   2. 调 aiChat（自动兜底）
 *   3. 解析 JSON → zod 校验
 *   4. PII 黑名单
 *   5. 失败 fallback：返回 score=60 + 通用 suggestions
 */
import { aiChat } from '@/lib/ai/router';
import {
  ScoreInputSchema,
  ScoreOutputSchema,
  type ScoreInput,
  type ScoreOutput,
} from './dimensions';

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

function buildScoringPrompt(input: ScoreInput): { system: string; user: string } {
  const system = `你是 ${input.company.toUpperCase()} 面试场景下的"${input.dimension}"维度评分官。
候选人岗位：${input.role}，职级：${input.level}。

## 评分标准（0-100）
- 90-100: 远超岗位预期，有独到见解或深度
- 75-89:  达到岗位要求，无明显短板
- 60-74:  基本合格，有 1-2 个明显不足
- 40-59:  有较大提升空间
- 0-39:   与岗位不匹配

## 严禁询问或输出
- 婚否 / 子女 / 是否有房 / 年龄
- 与岗位能力无关的 PII

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
