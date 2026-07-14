/**
 * 评分单元测试 — mock aiChat，覆盖 4 公司 × 聚合
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/router', () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from '@/lib/ai/router';
import { scoreOne } from '../../lib/scoring/scorer';
import { aggregate } from '../../lib/scoring/aggregator';
import {
  DIMENSION_WEIGHTS,
  activeDimensions,
  type ScoreOutput,
} from '../../lib/scoring/dimensions';
import '../../lib/agents/interviewer/types';

const mockAiChat = vi.mocked(aiChat);

function mockScoreResponse(score: number, evidence = 'mock evidence'): ScoreOutput {
  return {
    score,
    evidence,
    suggestions: ['mock suggestion 1', 'mock suggestion 2'],
  };
}

beforeEach(() => mockAiChat.mockReset());

describe.each(['byte', 'ali', 'tencent', 'bili'] as const)('scorer company=%s', (company) => {
  it('returns valid ScoreOutput', async () => {
    mockAiChat.mockResolvedValueOnce({
      content: JSON.stringify(mockScoreResponse(85)),
      provider: 'minimax',
      model: 'MiniMax-M3',
    });

    const out = await scoreOne({
      company,
      role: '后端工程师',
      level: 'P6',
      dimension: 'tech',
      transcript: [
        { role: 'assistant', content: '介绍一下你最近的项目' },
        { role: 'user', content: '我做了一个订单系统重构' },
      ],
    });
    expect(out.score).toBe(85);
    expect(out.evidence).toBeTruthy();
    expect(out.suggestions.length).toBeGreaterThan(0);
  });

  it('falls back on AI failure', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('AI down'));
    const out = await scoreOne({
      company,
      role: '后端',
      level: 'P6',
      dimension: 'tech',
      transcript: [{ role: 'user', content: 'test' }],
    });
    expect(out.score).toBe(60);
    expect(out.suggestions).toContain('建议人工复盘');
  });

  it('PII guard catches violation', async () => {
    mockAiChat.mockResolvedValueOnce({
      content: JSON.stringify({
        score: 70,
        evidence: '候选人 35 岁',
        suggestions: ['建议'],
      }),
      provider: 'minimax',
      model: 'MiniMax-M3',
    });
    await expect(
      scoreOne({
        company,
        role: '后端',
        level: 'P6',
        dimension: 'tech',
        transcript: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toThrow(/PII/);
  });
});

describe('aggregator', () => {
  it('weights sum to 1.0 per company', () => {
    for (const c of ['byte', 'ali', 'tencent', 'bili'] as const) {
      const sum = Object.values(DIMENSION_WEIGHTS[c]).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
    }
  });

  it('activeDimensions returns non-zero weighted dims', () => {
    const dims = activeDimensions('byte');
    expect(dims).toContain('algo');
    expect(dims).toContain('cs');
    expect(dims).toContain('project');
    expect(dims).not.toContain('star'); // byte 不启用 star
  });

  it('weighted total score', () => {
    const scores: Record<string, ScoreOutput> = {
      algo: mockScoreResponse(80),
      cs: mockScoreResponse(70),
      project: mockScoreResponse(90),
      sysdesign: mockScoreResponse(60),
      culture: mockScoreResponse(50),
    };
    const report = aggregate({ company: 'byte', scores });
    // byte 权重：0.30*80 + 0.20*70 + 0.25*90 + 0.15*60 + 0.10*50 = 24+14+22.5+9+5 = 74.5 → round 75
    expect(report.totalScore).toBeGreaterThanOrEqual(70);
    expect(report.totalScore).toBeLessThanOrEqual(80);
    expect(report.radar.algo).toBe(80);
    expect(report.strong).toContain('project'); // 90 分最高
    expect(report.weak).toContain('culture'); // 50 分最低
  });

  it('handles missing dimensions with default 60', () => {
    const report = aggregate({ company: 'ali', scores: {} });
    expect(report.totalScore).toBe(60);
    for (const v of Object.values(report.radar)) {
      expect(v).toBe(60);
    }
  });

  it('summary contains score + strong/weak labels', () => {
    const scores: Record<string, ScoreOutput> = {
      culture: mockScoreResponse(95),
      project: mockScoreResponse(40),
      star: mockScoreResponse(70),
      tech: mockScoreResponse(60),
      sysdesign: mockScoreResponse(60),
    };
    const report = aggregate({ company: 'ali', scores });
    expect(report.summary).toContain('总分');
    expect(report.summary).toContain('强项');
    expect(report.summary).toContain('弱项');
  });
});
