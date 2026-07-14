/**
 * EmailSender 抽象接口
 *
 * 设计目标：
 * - MVP 阶段用 ConsoleEmailSender（控制台日志 + DB 存验证码）
 * - 生产阶段切换到 TencentSESEmailSender（真实邮件投递）
 * - 调用方零改动，只需替换实现
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<EmailSendResult>;
}
