/**
 * Email 工厂 — 根据环境变量选择 EmailSender 实现
 *
 * 决策：
 * - EMAIL_SENDER_MODE=production  →  SesEmailSender（Tencent SES via SMTP）
 * - 默认 / EMAIL_SENDER_MODE=console → ConsoleEmailSender（写 stdout，dev/test 用）
 *
 * 这是单例：模块级 cache 避免每封邮件都做 env 检查
 */

import { ConsoleEmailSender } from './console-sender';
import { SesEmailSender } from './ses-sender';
import type { EmailSender } from './types';

let _sender: EmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (_sender) return _sender;
  const mode = process.env.EMAIL_SENDER_MODE || 'console';
  if (mode === 'production' || mode === 'ses') {
    _sender = new SesEmailSender();
  } else {
    _sender = new ConsoleEmailSender();
  }
  return _sender;
}

/** 测试辅助：清掉缓存的 sender（让单测可以切换模式） */
export function __resetEmailSenderForTesting(): void {
  _sender = null;
}

export type { EmailSender, EmailMessage, EmailSendResult } from './types';
