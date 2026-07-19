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
 *
 * Bug-022 (2026-07-20 E2E #4)：用户简历中出现"35+ 求职""38 岁后端"是合法
 * 的业务上下文，AI 在 question 中**主动询问**才算违规（如"你今年多大"）。
 * AI 引用用户简历里的年龄是合理的（如总结时"你有 10 年经验"——10 是从
 * 简历 38-28 推算的）。故拆分模式为「询问模式」(主动问) 与「被动陈述」。
 */
const PII_BLACKLIST: RegExp[] = [
  // 询问婚姻（含隐性"母胎单身"）— 移除"对象"，因为语义上「你对象是谁」
  // 和「推荐一个学习对象」会冲突，且"对象"单身用法不构成 PII 主问。
  /婚否|已婚|未婚|结婚|伴侣|母胎单身/,
  // 询问生育（含"二胎""生育计划"）
  /子女|孩子|生育|几岁（?!经验）|二胎|生育计划/,
  // 询问房产（含房贷 / 买房 / 户籍）
  /是否有房|有无房产|房贷|买房|房产|户籍|籍贯/,
  // 主动询问年龄（不是陈述）—— "你 X 岁 / 多大 / 几几年生 / 出生年份"
  /(你|您|是否)\s*(多大|几岁|多少岁|\d+\s*岁)|(你|您)\s*出生年份|几几年生/,
  // 询问性别 + 民族 + 宗教（移除"民族"作为通用中文词，只拦主动问）
  /(你|您|是否)\s*(男|女)|宗教信仰|是否党员/,
  // 询问身体 + 健康
  /身高|体重|健康状况|是否有疾病|残疾/,
  // 出生地
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

  /**
   * 解析 AI 输出为 InterviewerOutput。
   * P0-4 修复：去掉"用万能 fallback 文案伪装成功"的策略。
   * - 解析失败时抛错（让 route.ts catch 接住 → STREAM_ERROR 显式失败）
   * - 不再用 "请继续介绍您的项目" 当默认回复污染 history
   *
   * Phase 13.6 容错：Hy3/小模型经常输出 "好的，以下是 JSON:\n```json\n{...}\n```"
   * 或者解释+JSON混杂。再加两种提取方式以提高成功率。
   */
  private parseOutput(raw: string): InterviewerOutput {
    // 尝试 1：直接 JSON.parse
    try {
      return InterviewerOutputSchema.parse(JSON.parse(raw));
    } catch {
      // ignore
    }

    // 尝试 2：提取 ```json ... ``` 块
    const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (fenced) {
      try {
        return InterviewerOutputSchema.parse(JSON.parse(fenced[1]));
      } catch {
        // ignore
      }
    }

    // 尝试 3：提取首段 { ... } JSON 块（容错 Hy3 的 "以下是：" + 杂文本）
    // 用首个 { 到 最后一个匹配的 }（平衡匹配，简化版）
    const firstBrace = raw.indexOf('{');
    if (firstBrace !== -1) {
      // 从首 { 开始累计，到每个 } 算一次平衡；平衡=0 时结束
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (let i = firstBrace; i < raw.length; i++) {
        const ch = raw[i];
        if (inStr) {
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === '\\') {
            escape = true;
            continue;
          }
          if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') {
          inStr = true;
          continue;
        }
        if (ch === '{') {
          depth++;
          continue;
        }
        if (ch === '}') {
          depth--;
          if (depth === 0) {
            const candidate = raw.slice(firstBrace, i + 1);
            try {
              return InterviewerOutputSchema.parse(JSON.parse(candidate));
            } catch {
              break; // 退出去走 fallback 报错
            }
          }
        }
      }
    }

    // P0-4：解析彻底失败 → 抛错而不是返回 fallback 文案
    console.error('[interviewer] AI 输出非 JSON，无法 parse', { raw: raw.slice(0, 200) });
    throw new Error(`[interviewer] AI 输出非 JSON: ${raw.slice(0, 80)}`);
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
