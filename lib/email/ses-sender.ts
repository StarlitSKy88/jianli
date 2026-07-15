/**
 * Tencent SES 邮件发送器 — 生产环境
 *
 * 依赖：
 * - npm: nodemailer + @tencent-cloud/tencentcloud-sdk-nodejs（可选）
 * - 用 nodemailer + smtp 是最简单方案，无需加 SDK
 *
 * 必填环境变量：
 * - SMTP_HOST              e.g. gz-smtp.qcloudmail.com（广州机房）
 * - SMTP_PORT              e.g. 465（SSL）或 587（STARTTLS）
 * - SMTP_USER              e.g. nodemailer@taomyst.top
 * - SMTP_PASSWORD          SES 控制台生成的 SMTP 密码（不是登录密码）
 * - SMTP_FROM_NAME         e.g. "Interview Buddy"
 *
 * 选填：
 * - SMTP_SECURE            "true" 用 SSL（465），"false" 用 STARTTLS（587）。默认按端口推断
 *
 * 安全：
 * - 在工厂里 catch all 异常，返回 { ok: false, error }，绝不 throw 给主流程
 * - SSL/TLS 失败会回退到 STARTTLS（生产 465）
 */

import type { EmailSender, EmailMessage, EmailSendResult } from './types';
import nodemailer, { type Transporter } from 'nodemailer';

interface SesConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  fromName: string;
}

function readSesConfig(): SesConfig | null {
  const host = process.env.SMTP_HOST;
  const portStr = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const fromName = process.env.SMTP_FROM_NAME || 'Interview Buddy';
  if (!host || !portStr || !user || !password) {
    return null;
  }
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, user, password, from: user, fromName };
}

export class SesEmailSender implements EmailSender {
  private transporter: Transporter | null = null;

  private async getTransporter(): Promise<Transporter | null> {
    if (this.transporter) return this.transporter;
    const cfg = readSesConfig();
    if (!cfg) return null;

    // 默认按端口推 secure：465=SSL，其余 STARTTLS
    // 也可以用 SMTP_SECURE=true 显式强制
    const secureEnv = process.env.SMTP_SECURE;
    const secure = secureEnv ? secureEnv === 'true' : cfg.port === 465;

    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure,
      auth: { user: cfg.user, pass: cfg.password },
      // 防止重试拖死主流程
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    return this.transporter;
  }

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const cfg = readSesConfig();
    if (!cfg) {
      return {
        ok: false,
        error: 'SES 未配置：请设置 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD 环境变量',
      };
    }
    const transporter = await this.getTransporter();
    if (!transporter) {
      return { ok: false, error: '邮件传输器初始化失败' };
    }

    try {
      const info = await transporter.sendMail({
        from: `"${cfg.fromName}" <${cfg.from}>`,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      return { ok: true, messageId: info.messageId };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[ses-sender] send failed: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }
}
