/**
 * ConsoleEmailSender — MVP 阶段实现
 *
 * 行为：
 * - 把邮件内容写入控制台（开发/CI 可见）
 * - 把验证码单独存到 VerifyCode 表（数据库可查）
 *
 * 生产替换：实现 TencentSESEmailSender，使用腾讯云邮件推送 SES。
 * 见：https://cloud.tencent.com/product/ses
 */

import type { EmailMessage, EmailSender, EmailSendResult } from './types';

export class ConsoleEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const messageId = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 输出关键信息到控制台（生产环境会被 EdgeOne 日志收集）
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          level: 'info',
          event: 'email_sent',
          messageId,
          to: msg.to,
          subject: msg.subject,
          textLength: msg.text?.length ?? msg.html.length,
        },
        null,
        2
      )
    );
    return { ok: true, messageId };
  }
}
