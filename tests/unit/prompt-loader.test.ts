/**
 * Prompt 加载器测试 — 性能 + 安全 + 类型
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPrompt,
  clearPromptCache,
  PromptLoadError,
} from '../../lib/agents/interviewer/prompt-loader';

describe('prompt-loader', () => {
  beforeEach(() => clearPromptCache());

  describe.each(['byte', 'ali', 'tencent', 'bili'] as const)('company=%s', (type) => {
    it('loads with valid meta', () => {
      const p = loadPrompt(type);
      expect(p.meta.type).toBe(type);
      expect(p.meta.name).toBeTruthy();
      expect(p.meta.personality).toBeTruthy();
      expect(p.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.body.length).toBeGreaterThan(100);
    });

    it('weights sum to ~1.0', () => {
      const p = loadPrompt(type);
      const sum = Object.values(p.meta.weights).reduce((a, b) => a + (b || 0), 0);
      expect(sum).toBeGreaterThan(0.95);
      expect(sum).toBeLessThan(1.05);
    });
  });

  it('rejects non-whitelist company', () => {
    expect(() => loadPrompt('google' as never)).toThrow(PromptLoadError);
  });

  it('rejects path traversal', () => {
    expect(() => loadPrompt('../etc' as never)).toThrow(PromptLoadError);
  });

  it('performance: 4 companies load < 200ms (cold)', () => {
    clearPromptCache();
    const t0 = Date.now();
    for (const t of ['byte', 'ali', 'tencent', 'bili'] as const) {
      loadPrompt(t);
    }
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(200);
  });

  it('performance: cached load < 5ms', () => {
    loadPrompt('byte');
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) loadPrompt('byte');
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(50);
  });
});
