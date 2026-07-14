/**
 * Email 工厂 — 根据环境变量选择 EmailSender 实现
 *
 * 当前支持：
 * - console（默认，MVP 阶段）
 *
 * 未来扩展：
 * - tencent-ses（生产环境，需要 SES_SECRET_ID/SES_SECRET_KEY）
 */

import { ConsoleEmailSender } from './console-sender';
import type { EmailSender } from './types';

let _sender: EmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (_sender) return _sender;
  // 后续根据 process.env.EMAIL_PROVIDER 切换
  _sender = new ConsoleEmailSender();
  return _sender;
}

export type { EmailSender, EmailMessage, EmailSendResult } from './types';
