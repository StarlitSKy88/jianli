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
    guardPII(out); // PII 红线必须 throw
    guardCitation(out, parsed.transcript); // 反幻觉校验（Phase 14.25）
    return out;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg?.includes('PII 红线')) throw e; // PII 红线不吞
    if (msg?.includes('反幻觉拦截')) {
      // 反幻觉：fallback 60 + 标记低 confidence（不 throw，避免阻断整轮）
      console.warn(`[scorer] 反幻觉降级 → fallback 60 分，evidence 标记为"需人工复盘"`);
      return {
        ...FALLBACK,
        evidence: '反幻觉门禁触发：AI 给出的引用未在对话中找到',
        confidence: 0.3,
      };
    }
    console.warn(`[scorer] scoreOne failed: ${msg}`);
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

/**
 * 反幻觉校验（Phase 14.25）：
 *   AI 给出的 citationQuotes 必须能在 transcript 中找到（防凭空编造）
 *
 * 算法：
 *   - 取 transcript.user.content 拼成单一字符串
 *   - 对每个 citationQuote，用 includes() 检查是否出现在候选人原话里
 *   - 至少 1 个有效引用才算"有据可查"
 *   - 0 个有效 → 拒绝，抛出"反幻觉拦截"（同 PII 行为：throw 让上层 fallback 60 分）
 *
 * 设计选择：
 *   - 不做语义匹配（太重，依赖嵌入模型），用字面 includes 足够防明显幻觉
 *   - 容忍 LLM 截断/标点差异：quote 长度 ≥ 10 字才校验（避免 "是" "的" 这种小碎片误报）
 *   - transcript 为空时跳过校验（不阻塞降级路径）
 */
export function guardCitation(
  out: ScoreOutput,
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>
): void {
  // 旧 schema 不带 citationQuotes → 跳过（向后兼容）
  if (!out.citationQuotes || out.citationQuotes.length === 0) return;

  const userUtterances = transcript
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

  if (!userUtterances) {
    // transcript 没有任何候选人发言，无法校验 → 不阻断，但记 warn
    console.warn(`[scorer] 反幻觉跳过：transcript 无 user 消息`);
    return;
  }

  // 至少 1 个引用能在 userUtterances 中找到
  const minQuoteLen = 10; // 短于 10 字太容易误报（"Redis" 这种）
  const valid = out.citationQuotes.filter((q) => {
    const trimmed = q.trim();
    if (trimmed.length < minQuoteLen) return false;
    return userUtterances.includes(trimmed);
  });

  if (valid.length === 0) {
    throw new Error(
      `[scorer] 反幻觉拦截：${out.citationQuotes.length} 个引用无一个在 transcript 中找到（防 LLM 编造）`
    );
  }
}
