/**
 * 面试官主类 — 4 家公司共用同一份代码（DRY）
 *
 * 流程：
 *   1. 加载 system prompt（含 personality + 红线 + 输出格式）
 *   2. 拼接 ctx（resume + history）→ 构造 messages
 *   3. 调用 aiChat（自动兜底 minimax → Claude → DeepSeek）
 *   4. 解析 JSON → zod 校验 → InterviewerOutput
 *   5. 输出黑名单扫描（防 AI 输出 PII）
 */
import { z } from 'zod';
import { aiChat } from '@/lib/ai/router';
import {
  InterviewerOutputSchema,
  type InterviewerContext,
  type InterviewerOutput,
  type InterviewerType,
} from './types';
import { loadPrompt } from './prompt-loader';

/**
 * PII 黑名单 — 即使 AI 想输出也强制拦下
 *
 * 覆盖《就业促进法》第 27 条 + 《个人信息保护法》核心红线：
 *   婚姻状态、生育状态、房产、年龄、性别、民族、宗教、户籍、身体、出生、对象
 *
 * 注意：黑名单在「AI 输出端」扫描一次。question + nextFocus 双字段。
 */
const PII_BLACKLIST: RegExp[] = [
  // 婚姻（含隐性"对象""母胎单身"）
  /婚否|已婚|未婚|结婚|伴侣|对象|母胎单身/,
  // 生育（含"二胎""生育计划"）
  /子女|孩子|生育|几岁（?!经验）|二胎|生育计划/,
  // 房产（含房贷 / 买房 / 户籍）
  /是否有房|有无房产|房贷|买房|房产|户籍|籍贯/,
  // 年龄（含出生年份 / 几几年生）
  /\d{2}\s*岁|年龄|几几年生|出生年份/,
  // 性别 + 民族 + 宗教
  /性别|民族|宗教信仰|是否党员/,
  // 身体 + 健康
  /身高|体重|健康状况|是否有疾病|残疾/,
  // 出生地（与户籍重叠但单独保留，区分"出生"和"籍贯"）
  /出生地|哪里人|老家|父母.*同住/,
];

export class Interviewer {
  private readonly ctx: InterviewerContext;

  constructor(ctx: InterviewerContext) {
    this.ctx = ctx;
  }

  /**
   * 输出一句面试官问题
   */
  async ask(): Promise<InterviewerOutput> {
    const prompt = loadPrompt(this.ctx.company);
    const messages = this.buildMessages(prompt.body);

    const result = await aiChat(messages, {
      temperature: 0.7,
      maxTokens: 800,
    });

    const parsed = this.parseOutput(result.content);
    this.guardPII(parsed);
    return parsed;
  }

  /** 构造 messages：system + 历史对话 */
  private buildMessages(
    systemPrompt: string
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: this.renderSystemPrompt(systemPrompt) },
    ];

    for (const turn of this.ctx.history) {
      messages.push({ role: turn.role, content: turn.content });
    }
    // 留 1 个 user 触发下一轮
    messages.push({
      role: 'user',
      content: '请按 system prompt 中规定的 JSON schema 继续提问。',
    });
    return messages;
  }

  /** 注入候选人 ctx 到 system prompt */
  private renderSystemPrompt(base: string): string {
    const ctxJson = JSON.stringify(
      {
        company: this.ctx.company,
        role: this.ctx.role,
        level: this.ctx.level,
        resume: this.ctx.resume,
      },
      null,
      2
    );
    return `${base}\n\n## 当前候选人上下文\n${ctxJson}\n\n## 提醒\n- 输出严格 JSON（不要包裹 \`\`\`json 代码块）\n- 严格遵守红线（不问 PII）`;
  }

  /** 解析 AI 输出为 InterviewerOutput，失败 fallback 文本模式 */
  private parseOutput(raw: string): InterviewerOutput {
    // 尝试 1：直接 JSON.parse
    try {
      return InterviewerOutputSchema.parse(JSON.parse(raw));
    } catch {
      // ignore, try fenced
    }

    // 尝试 2：提取 ```json ... ``` 块
    const m = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (m) {
      try {
        return InterviewerOutputSchema.parse(JSON.parse(m[1]));
      } catch {
        // ignore
      }
    }

    // 尝试 3：文本 fallback（用最宽容的 schema）
    console.warn(`[interviewer] AI 输出非 JSON, fallback: ${raw.slice(0, 100)}`);
    const cleanedQuestion = raw.trim().slice(0, 500) || '请继续介绍您的项目。';
    return {
      question: cleanedQuestion,
      dimension: 'tech',
      phase: 'deep',
    };
  }

  /** PII 黑名单扫描 — 即使 AI 输出也强制拦下 */
  private guardPII(out: InterviewerOutput): void {
    for (const re of PII_BLACKLIST) {
      if (re.test(out.question) || (out.nextFocus && re.test(out.nextFocus))) {
        throw new Error(`[interviewer] PII 红线拦截: question="${out.question.slice(0, 50)}"`);
      }
    }
  }
}

export { type InterviewerContext, type InterviewerOutput, type InterviewerType };
export { loadPrompt, clearPromptCache } from './prompt-loader';
export { PromptLoadError } from './prompt-loader';
export const InterviewerOutputSchemaExport = InterviewerOutputSchema;
export type { Dimension } from './types';

// zod 静态校验辅助
export const validateOutput = (raw: unknown): InterviewerOutput =>
  InterviewerOutputSchema.parse(raw);
export const safeValidateOutput = (
  raw: unknown
): z.SafeParseReturnType<unknown, InterviewerOutput> => InterviewerOutputSchema.safeParse(raw);
