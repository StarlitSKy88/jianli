/**
 * 评分 prompt 加载器测试
 *
 * 覆盖：
 * - 8 个 prompt 文件全部存在（4 公司 × 2 关键维度）
 * - front-matter schema 校验（company/dimension/weight 一致）
 * - 白名单拒绝非法值
 * - 缓存命中
 * - 与真实 scorer 集成（scoreOne 能跑通）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadScorerPrompt,
  clearScorerPromptCache,
  ScorerPromptLoadError,
  type ScorerCompany,
  type ScorerDimension,
} from '@/lib/scoring/prompt-loader';

const CASES: Array<[ScorerCompany, ScorerDimension]> = [
  ['byte', 'algo'],
  ['byte', 'project'],
  ['ali', 'culture'],
  ['ali', 'project'],
  ['tencent', 'project'],
  ['tencent', 'pressure'],
  ['bili', 'culture'],
  ['bili', 'project'],
];

describe('scorer-prompt-loader', () => {
  beforeEach(() => clearScorerPromptCache());

  it('rejects non-whitelisted company', () => {
    expect(() => loadScorerPrompt('google' as never, 'algo')).toThrow(ScorerPromptLoadError);
  });

  it('rejects non-whitelisted dimension', () => {
    expect(() => loadScorerPrompt('byte', 'beauty' as never)).toThrow(ScorerPromptLoadError);
  });

  it.each(CASES)('loads %s/%s successfully', (company, dimension) => {
    const p = loadScorerPrompt(company, dimension);
    expect(p.meta.company).toBe(company);
    expect(p.meta.dimension).toBe(dimension);
    expect(p.meta.weight).toBeGreaterThan(0);
    expect(p.body.length).toBeGreaterThan(200);
    expect(p.body).toContain('红线'); // 必须包含红线声明
  });

  it('caches subsequent loads', () => {
    const a = loadScorerPrompt('byte', 'algo');
    const b = loadScorerPrompt('byte', 'algo');
    expect(a).toBe(b); // 引用相等即命中缓存
  });

  it('all 8 prompts reference 35+ friendliness or PII red line', () => {
    for (const [c, d] of CASES) {
      clearScorerPromptCache();
      const p = loadScorerPrompt(c, d);
      // 至少提到 PII 红线 或 35+ 友好
      const ok = p.body.includes('红线') || p.body.includes('35+');
      expect(ok, `${c}/${d} 缺少红线/35+ 友好声明`).toBe(true);
    }
  });
});

/**
 * 集成测试：scoreOne + aiChat mock 验证 prompt 内容被正确组装
 */
describe('scorer integration: prompt assembly', () => {
  beforeEach(() => {
    clearScorerPromptCache();
    vi.resetModules();
  });

  it('byte/algo prompt contains scoring rubric', async () => {
    const aiChatMock = vi.fn().mockResolvedValue({
      content: JSON.stringify({ score: 80, evidence: '解法清晰', suggestions: ['优化空间复杂度'] }),
    });
    vi.doMock('@/lib/ai/router', () => ({ aiChat: aiChatMock }));

    const { scoreOne } = await import('@/lib/scoring/scorer');
    const out = await scoreOne({
      company: 'byte',
      role: '高级工程师',
      level: 'P6',
      dimension: 'algo',
      transcript: [{ role: 'user', content: '我先排序再双指针' }],
    });

    expect(out.score).toBe(80);
    expect(aiChatMock).toHaveBeenCalledOnce();
    const systemMsg = aiChatMock.mock.calls[0][0][0].content;
    expect(systemMsg).toContain('字节'); // 包含中文公司名或 RUBRIC
    expect(systemMsg).toMatch(/0-100|评分范围|远超预期/);
    expect(systemMsg).toContain('红线'); // 来自加载的 prompt body
    expect(systemMsg).toContain('P6'); // 上下文
  });

  it('ali/culture prompt emphasizes STAR + 六脉神剑', async () => {
    const aiChatMock = vi.fn().mockResolvedValue({
      content: JSON.stringify({ score: 75, evidence: '举例真实', suggestions: ['加强反思'] }),
    });
    vi.doMock('@/lib/ai/router', () => ({ aiChat: aiChatMock }));

    const { scoreOne } = await import('@/lib/scoring/scorer');
    await scoreOne({
      company: 'ali',
      role: '技术专家',
      level: 'P7',
      dimension: 'culture',
      transcript: [{ role: 'user', content: '去年双 11 我主动通宵' }],
    });

    const systemMsg = aiChatMock.mock.calls[0][0][0].content;
    expect(systemMsg).toContain('客户第一');
    expect(systemMsg).toContain('六脉神剑');
  });

  it('falls back to score=60 when AI returns non-JSON', async () => {
    const aiChatMock = vi.fn().mockResolvedValue({ content: 'this is not json at all' });
    vi.doMock('@/lib/ai/router', () => ({ aiChat: aiChatMock }));

    const { scoreOne } = await import('@/lib/scoring/scorer');
    const out = await scoreOne({
      company: 'tencent',
      role: '后端',
      level: 'T3',
      dimension: 'pressure',
      transcript: [{ role: 'user', content: 'hello' }],
    });
    expect(out.score).toBe(60);
    expect(out.suggestions).toContain('建议人工复盘');
  });

  it('throws on PII red-line violation (no fallback)', async () => {
    const aiChatMock = vi.fn().mockResolvedValue({
      content: JSON.stringify({ score: 80, evidence: '候选人已婚', suggestions: ['继续'] }),
    });
    vi.doMock('@/lib/ai/router', () => ({ aiChat: aiChatMock }));

    const { scoreOne } = await import('@/lib/scoring/scorer');
    await expect(
      scoreOne({
        company: 'bili',
        role: '运营',
        level: 'L5',
        dimension: 'project',
        transcript: [{ role: 'user', content: '...' }],
      })
    ).rejects.toThrow(/PII 红线/);
  });
});
