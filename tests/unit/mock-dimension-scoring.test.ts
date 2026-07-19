/**
 * Mock Provider 单元测试 — 验证 #142 修复
 *
 * 关键断言：
 *   1. 30 个不同问题（不重复）
 *   2. 每个维度的评分不同（不再全是 75 分）
 *   3. evidence/suggestions 按维度差异化
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getMockProvider } from '@/lib/ai/providers/mock';

describe('MockProvider — #142 修复验证', () => {
  beforeEach(() => {
    delete process.env.USE_MOCK_AI; // 让每个测试自己设
  });

  it('未启用时返回 null', () => {
    delete process.env.USE_MOCK_AI;
    expect(getMockProvider()).toBeNull();
  });

  it('USE_MOCK_AI=1 时返回实例', () => {
    process.env.USE_MOCK_AI = '1';
    const p = getMockProvider();
    expect(p).not.toBeNull();
    expect(p?.name).toBe('mock');
  });

  it('面试官模式：30 个不同问题（不重复）', async () => {
    process.env.USE_MOCK_AI = '1';
    const p = getMockProvider()!;
    const questions = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = await p.chat([{ role: 'system', content: '你是面试官' }]);
      const parsed = JSON.parse(r.content);
      questions.add(parsed.question);
    }
    expect(questions.size).toBe(30); // 30 个全不同
  });

  it('#142 核心：评分模式按维度返回差异化分数（不再全是 75）', async () => {
    process.env.USE_MOCK_AI = '1';
    const p = getMockProvider()!;
    const dims = ['tech', 'project', 'sysdesign', 'algo', 'cs', 'culture', 'star', 'pressure'];
    const scores: Record<string, { score: number; evidence: string }> = {};
    for (const dim of dims) {
      const r = await p.chat([
        { role: 'system', content: `你是字节面试官评分员\n- 评分维度：${dim}` },
        { role: 'user', content: '候选人的回答...' },
      ]);
      const parsed = JSON.parse(r.content);
      scores[dim] = { score: parsed.score, evidence: parsed.evidence };
    }
    // 断言：8 个维度的分数不能全是同一个值
    const distinctScores = new Set(Object.values(scores).map((s) => s.score));
    expect(distinctScores.size).toBeGreaterThanOrEqual(6); // 至少 6 个不同分数
    // 断言：每个维度的 evidence 字符串互不相同
    const distinctEvidence = new Set(Object.values(scores).map((s) => s.evidence));
    expect(distinctEvidence.size).toBe(8);
  });

  it('system 不含"评分维度"时走面试官模式', async () => {
    process.env.USE_MOCK_AI = '1';
    const p = getMockProvider()!;
    const r = await p.chat([{ role: 'system', content: '你是面试官' }]);
    const parsed = JSON.parse(r.content);
    expect(parsed.question).toBeDefined();
    expect(parsed.dimension).toBeDefined();
    expect(parsed.phase).toBeDefined();
  });
});
