/**
 * 防刷号三件套单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  isHoneypotTriggered,
  checkRateLimit,
  resetRateLimit,
  clearAllRateLimits,
  getClientIp,
  verifyTurnstile,
  HONEYPOT_FIELDS,
  RATE_LIMITS,
} from '@/lib/auth/anti-abuse';

describe('honeypot', () => {
  it('clean body ok', () => {
    expect(isHoneypotTriggered({ email: 'a@b.com', password: 'x' })).toBe(false);
  });

  it('website filled triggers', () => {
    expect(isHoneypotTriggered({ website: 'http://spam.com' })).toBe(true);
  });

  it.each(HONEYPOT_FIELDS)('%s filled triggers', (field) => {
    expect(isHoneypotTriggered({ [field]: 'spam' })).toBe(true);
  });

  it('empty/whitespace does not trigger', () => {
    expect(isHoneypotTriggered({ website: '' })).toBe(false);
    expect(isHoneypotTriggered({ website: '   ' })).toBe(false);
  });

  it('non-string does not trigger', () => {
    expect(isHoneypotTriggered({ website: 123 as unknown })).toBe(false);
  });
});

describe('rate limit', () => {
  beforeEach(() => clearAllRateLimits());

  it('allows up to maxHits then rejects', () => {
    const cfg = { maxHits: 3, windowMs: 60_000 };
    expect(checkRateLimit('ip-1', cfg.maxHits, cfg.windowMs)).toBe(true);
    expect(checkRateLimit('ip-1', cfg.maxHits, cfg.windowMs)).toBe(true);
    expect(checkRateLimit('ip-1', cfg.maxHits, cfg.windowMs)).toBe(true);
    expect(checkRateLimit('ip-1', cfg.maxHits, cfg.windowMs)).toBe(false);
    expect(checkRateLimit('ip-1', cfg.maxHits, cfg.windowMs)).toBe(false);
  });

  it('recovers after window', () => {
    vi.useFakeTimers();
    const cfg = { maxHits: 2, windowMs: 1000 };
    expect(checkRateLimit('ip-2', cfg.maxHits, cfg.windowMs)).toBe(true);
    expect(checkRateLimit('ip-2', cfg.maxHits, cfg.windowMs)).toBe(true);
    expect(checkRateLimit('ip-2', cfg.maxHits, cfg.windowMs)).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(checkRateLimit('ip-2', cfg.maxHits, cfg.windowMs)).toBe(true);
    vi.useRealTimers();
  });

  it('separate keys isolated', () => {
    const cfg = { maxHits: 1, windowMs: 60_000 };
    expect(checkRateLimit('ip-A', cfg.maxHits, cfg.windowMs)).toBe(true);
    expect(checkRateLimit('ip-B', cfg.maxHits, cfg.windowMs)).toBe(true);
    expect(checkRateLimit('ip-A', cfg.maxHits, cfg.windowMs)).toBe(false);
  });

  it('resetRateLimit clears one key', () => {
    const cfg = { maxHits: 1, windowMs: 60_000 };
    checkRateLimit('ip-X', cfg.maxHits, cfg.windowMs);
    expect(checkRateLimit('ip-X', cfg.maxHits, cfg.windowMs)).toBe(false);
    resetRateLimit('ip-X');
    expect(checkRateLimit('ip-X', cfg.maxHits, cfg.maxHits)).toBe(true);
  });

  it('RATE_LIMITS defaults correct', () => {
    expect(RATE_LIMITS.register).toEqual({ maxHits: 3, windowMs: 5 * 60_000 });
    expect(RATE_LIMITS.sendVerifyCode).toEqual({ maxHits: 1, windowMs: 60_000 });
    expect(RATE_LIMITS.login).toEqual({ maxHits: 10, windowMs: 5 * 60_000 });
  });
});

describe('getClientIp', () => {
  function mockReq(headers: Record<string, string>) {
    return {
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    };
  }

  it('prefers CF-Connecting-IP', () => {
    expect(
      getClientIp(
        mockReq({
          'cf-connecting-ip': '1.1.1.1',
          'x-real-ip': '2.2.2.2',
          'x-forwarded-for': '3.3.3.3',
        })
      )
    ).toBe('1.1.1.1');
  });

  it('falls back to X-Real-IP', () => {
    expect(getClientIp(mockReq({ 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
  });

  it('falls back to first XFF', () => {
    expect(getClientIp(mockReq({ 'x-forwarded-for': '3.3.3.3, 10.0.0.1' }))).toBe('3.3.3.3');
  });

  it('returns unknown when none', () => {
    expect(getClientIp(mockReq({}))).toBe('unknown');
  });
});

describe('verifyTurnstile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('dev without secret → ok=true', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    const r = await verifyTurnstile('any-token');
    expect(r.ok).toBe(true);
  });

  it('prod without secret → fail missing-secret-key', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const r = await verifyTurnstile('any-token');
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toContain('missing-secret-key');
  });

  it('prod empty token → fail missing-input-response', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    const r = await verifyTurnstile('');
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toContain('missing-input-response');
  });

  it('prod success → ok', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    );
    const r = await verifyTurnstile('valid-token', '1.2.3.4');
    expect(r.ok).toBe(true);
  });

  it('prod failure → error codes', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
        })
    );
    const r = await verifyTurnstile('bad-token');
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toContain('invalid-input-response');
  });

  it('prod network error → network code', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const r = await verifyTurnstile('any-token');
    expect(r.ok).toBe(false);
    expect(r.errorCodes?.[0]).toMatch(/^network:/);
  });

  it('prod http 500 → http-500', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const r = await verifyTurnstile('any-token');
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toContain('http-500');
  });
});
