/**
 * 埋点 — fire-and-forget，不阻塞主流程
 *
 * 对齐 Prisma schema: TrackEvent(userId?, eventName, properties, sessionId?)
 */
import { prisma } from '@/lib/db/client';

export type TrackEventName =
  | 'interview_start'
  | 'message_sent'
  | 'interview_finish'
  | 'report_view'
  | 'pay_click'
  | 'register_success'
  | 'register_fail'
  | 'verify_code_request';

const EVENT_WHITELIST: ReadonlySet<string> = new Set([
  'interview_start',
  'message_sent',
  'interview_finish',
  'report_view',
  'pay_click',
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
