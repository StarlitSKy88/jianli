/**
 * 埋点 — fire-and-forget，不阻塞主流程
 *
 * 对齐 Prisma schema: TrackEvent(userId?, eventName, properties, sessionId?)
 *
 * PRD § 9 5 个核心埋点（生长漏斗必备）：
 *   signup_complete      注册成功
 *   resume_uploaded      简历解析成功
 *   interview_started    面试开始
 *   interview_completed  面试结束
 *   payment_success      支付成功
 *
 * 其它次级事件：message_sent / report_view / pay_click / 注册失败 / 反作弊信号
 */
import { prisma } from '@/lib/db/client';

/**
 * TrackEventName — 全部白名单事件名
 *
 * 5 个核心业务事件（PRD）必须 trigger，否则 funnel 计算缺失：
 * - signup_complete / resume_uploaded / interview_started / interview_completed / payment_success
 */
export type TrackEventName =
  // === PRD § 9 5 个核心埋点 ===
  | 'signup_complete' // = 老 register_success
  | 'resume_uploaded' // 新增 — 简历解析成功（不再仅限于 upload，点击"开始面试"按钮也算）
  | 'interview_started' // = 老 interview_start
  | 'interview_completed' // = 老 interview_finish
  | 'payment_success' // 新增 — 真实支付成功回调（pay_click 是按钮点击，分开）
  // === 次级（功能埋点）===
  | 'message_sent' // 面试中发送消息
  | 'report_view' // 报告页打开
  | 'pay_click' // "付费"按钮点击（漏斗顶端，与 payment_success 配套）
  // === 反作弊 / 失败埋点（dev 调试用，生产可关掉）===
  | 'register_fail'
  | 'verify_code_request'
  | 'register_honeypot'
  | 'verify_code_honeypot'
  | 'register_rate_limited'
  | 'login_rate_limited'
  | 'feedback_honeypot'
  | 'feedback_submit'
  // === Phase 14.32 密码重置流程 ===
  | 'reset_code_request'
  | 'reset_code_honeypot'
  | 'password_reset_success'
  | 'reset_password_honeypot';

/**
 * 5 个核心事件必须真实写库（关业务决策）。
 * 其它事件如果未来要更省 DB，可改成采样埋点；MVP 阶段全白名单。
 */
const EVENT_WHITELIST: ReadonlySet<string> = new Set([
  // PRD 核心
  'signup_complete',
  'resume_uploaded',
  'interview_started',
  'interview_completed',
  'payment_success',
  // 次级
  'message_sent',
  'report_view',
  'pay_click',
  // 反作弊 — 写库便于事后排查
  'register_fail',
  'verify_code_request',
  'register_honeypot',
  'verify_code_honeypot',
  'register_rate_limited',
  'login_rate_limited',
  'feedback_honeypot',
  'feedback_submit',
  // Phase 14.32 密码重置
  'reset_code_request',
  'reset_code_honeypot',
  'password_reset_success',
  'reset_password_honeypot',
]);

export function track(
  userId: string | null,
  event: TrackEventName,
  props?: Record<string, string | number | boolean>
): void {
  if (!EVENT_WHITELIST.has(event)) {
    console.warn(`[track] 非白名单事件: ${event}`);
    return;
  }
  void prisma.trackEvent
    .create({
      data: {
        userId,
        eventName: event,
        properties: (props || {}) as object,
      },
    })
    .catch((e) => console.warn(`[track] 写库失败: ${(e as Error).message}`));
}
