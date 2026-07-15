/**
 * SesEmailSender 单测
 *
 * 行为契约：
 * - 缺 SMTP env → 返回 { ok: false, error: SES 未配置... }（不 throw）
 * - SMTP env 完整但 transporter.sendMail 抛错 → { ok: false, error: ... }
 * - 成功路径 → { ok: true, messageId }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock 工厂会被 hoist，必须用 vi.hoisted() 把 mock 函数提到顶部
const { mockSendMail, mockCreateTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));
  return { mockSendMail: sendMail, mockCreateTransport: createTransport };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
  createTransport: mockCreateTransport,
}));

import { SesEmailSender } from './ses-sender';

function setEnv(vars: Record<string, string | undefined>) {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

const EMAIL = { to: 'to@example.com', subject: 's', text: 't', html: '<p>t</p>' };

describe('SesEmailSender', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = setEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'user@example.com',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_NAME: 'Test',
    });
  });

  it('returns ok=false when SMTP env incomplete (no host)', async () => {
    restore();
    restore = setEnv({
      SMTP_HOST: undefined,
      SMTP_PORT: '465',
      SMTP_USER: 'u@e.com',
      SMTP_PASSWORD: 's',
    });
    const sender = new SesEmailSender();
    const r = await sender.send(EMAIL);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SES 未配置/);
  });

  it('returns ok=false when sendMail throws (ECONNREFUSED)', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const sender = new SesEmailSender();
    const r = await sender.send(EMAIL);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ECONNREFUSED');
  });

  it('returns ok=true with messageId on success', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: '<abc@e.com>' });
    const sender = new SesEmailSender();
    const r = await sender.send(EMAIL);
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('<abc@e.com>');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('infers secure=true on port 465', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'x' });
    const sender = new SesEmailSender();
    await sender.send(EMAIL);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true })
    );
  });

  afterEach(() => restore());
});
