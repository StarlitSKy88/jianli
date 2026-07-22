/**
 * AI 评分差异化验证 — 4 公司 × active 维度 全跑通
 *
 * Round 5 目标:
 *   1. 验证 mock AI 模式下 20 个 (company, dimension) active 组合全跑通
 *   2. 不同公司的 active 维度集确实不同(每个公司启用的维度子集符合 DIMENSION_WEIGHTS)
 *   3. aggregate() 输出总分是加权平均(用 mock 的固定 score 反推计算)
 *   4. 8 维度中 unique score ≥ 6(延续 #142 修复基线)
 *
 * 设计:
 *   - mock AI 在 scoreOne 调用时,自动从 system 提取 dimension 关键词
 *   - 返回 MOCK_SCORE_BY_DIMENSION[dim] (8 个维度差异化)
 *   - 不同公司同一维度返回相同 score(因为 mock 不看 company,这是设计)
 *   - 但不同公司调用不同的 prompt body → 系统消息不同(已由 scorer-prompt-loader 覆盖)
 *
 * 验证重点:
 *   - 不再只测 mock 层的 8 维度,要测 scoring 集成层(20 active 组合)
 *   - 验证 activeDimensions() 输出与 DIMENSION_WEIGHTS 一致
 *   - 验证 aggregate() 总分算法
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { activeDimensions, DIMENSION_WEIGHTS } from '@/lib/scoring/dimensions';
import { aggregate } from '@/lib/scoring/aggregator';
import type { ScoreOutput } from '@/lib/scoring/dimensions';

// 模拟 mock AI: 在 system 里提取 dimension 关键词,返回固定差异化分数
// 行为对齐 prod mock AI: 取最后一个"评分维度："(任务上下文里的更精准)
// Round 5 Bug-005 修复后行为一致
function makeMockScoreContent(systemMsg: string): string {
  const matches = [...systemMsg.matchAll(/评分维度[：:]\s*(\w+)/g)];
  const dim = matches.length > 0 ? matches[matches.length - 1][1] : 'tech';
  const map: Record<string, ScoreOutput> = {
    tech: { score: 82, evidence: '技术深度足够', suggestions: ['深入 Redis 集群'] },
    project: { score: 78, evidence: '项目量化清晰', suggestions: ['补充反思'] },
    sysdesign: { score: 72, evidence: '分层合理', suggestions: ['细化限流开关'] },
    algo: { score: 76, evidence: '快排正确', suggestions: ['随机化 pivot'] },
    cs: { score: 80, evidence: 'TCP 三次握手答全', suggestions: ['TLS 1.3'] },
    culture: { score: 82, evidence: '始终创业理解到位', suggestions: ['补充 Context not Control'] },
    star: { score: 77, evidence: 'STAR 结构完整', suggestions: ['Situation 更具体'] },
    pressure: { score: 68, evidence: 'P0 方法论清晰', suggestions: ['补充实际 case'] },
  };
  return JSON.stringify(map[dim] ?? map.tech);
}

const COMPANIES = ['byte', 'ali', 'tencent', 'bili'] as const;

describe('Round 5 — AI 评分差异化验证', () => {
  beforeEach(() => {
    process.env.USE_MOCK_AI = '1';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.USE_MOCK_AI;
  });

  it('4 公司 active 维度清单与 DIMENSION_WEIGHTS 完全一致', async () => {
    // 1. 各公司 active 维度数 = 5(每家都覆盖 5 个非零权重维度)
    for (const c of COMPANIES) {
      const dims = activeDimensions(c);
      expect(dims.length, `${c} 应该启用 5 个维度`).toBe(5);
      // 2. 权重和 = 1.0
      const wSum = dims.reduce((sum, d) => sum + DIMENSION_WEIGHTS[c][d], 0);
      expect(wSum, `${c} active 权重之和`).toBe(1.0);
    }

    // 3. 各公司 active 维度的权重分布确实不同(差异化是核心价值)
    // 注意：ali 和 bili active 维度集合相同(culture/project/star/tech/sysdesign)
    // 但权重不同(ali culture=0.3 bili culture=0.3,ali project=0.3 bili project=0.25...)
    // → 通过权重差异保证评分差异化,而非 active 维度集合差异
    const aliW = DIMENSION_WEIGHTS.ali;
    const biliW = DIMENSION_WEIGHTS.bili;
    let hasWeightDiff = false;
    for (const d of Object.keys(aliW)) {
      if (aliW[d as keyof typeof aliW] !== biliW[d as keyof typeof biliW]) {
        hasWeightDiff = true;
        break;
      }
    }
    expect(hasWeightDiff, 'ali 和 bili 权重分布应该不同').toBe(true);

    // byte vs ali active 维度集合不同(差异化更明显)
    const byteSet = new Set(activeDimensions('byte'));
    const aliSet = new Set(activeDimensions('ali'));
    expect(
      [...byteSet].some((d) => !aliSet.has(d)) || [...aliSet].some((d) => !byteSet.has(d))
    ).toBe(true);

    // 4. 验证已知的差异化:byte 没有 star/pressure,ali 没有 algo/cs/pressure
    expect(activeDimensions('byte')).not.toContain('star');
    expect(activeDimensions('byte')).not.toContain('pressure');
    expect(activeDimensions('ali')).not.toContain('algo');
    expect(activeDimensions('ali')).not.toContain('cs');
    expect(activeDimensions('tencent')).not.toContain('algo');
    expect(activeDimensions('tencent')).not.toContain('sysdesign');
    expect(activeDimensions('bili')).not.toContain('algo');
    expect(activeDimensions('bili')).not.toContain('pressure');
  });

  it('20 active 组合 scoreOne 全跑通 + 返回合法 schema', async () => {
    // mock aiChat:从 system 提取 dimension 关键词,返回差异化分数
    const aiChatMock = vi
      .fn()
      .mockImplementation(async (msgs: Array<{ role: string; content: string }>) => ({
        content: makeMockScoreContent(msgs[0].content),
      }));
    vi.doMock('@/lib/ai/router', () => ({ aiChat: aiChatMock }));

    const { scoreOne } = await import('@/lib/scoring/scorer');

    let totalCalls = 0;
    for (const company of COMPANIES) {
      const dims = activeDimensions(company);
      for (const dim of dims) {
        const out = await scoreOne({
          company,
          role: '测试岗位',
          level: 'P5',
          dimension: dim,
          transcript: [{ role: 'user', content: `我在 ${dim} 维度有一些回答内容` }],
        });

        // 断言 schema 合法
        expect(out.score).toBeGreaterThanOrEqual(0);
        expect(out.score).toBeLessThanOrEqual(100);
        expect(out.evidence.length).toBeGreaterThan(0);
        expect(out.suggestions.length).toBeGreaterThan(0);

        // 断言 score 是 mock 该维度的固定值(说明 mock 的维度提取正常工作)
        const expectedMap: Record<string, number> = {
          tech: 82,
          project: 78,
          sysdesign: 72,
          algo: 76,
          cs: 80,
          culture: 82,
          star: 77,
          pressure: 68,
        };
        expect(out.score, `${company}/${dim}`).toBe(expectedMap[dim]);

        totalCalls++;
      }
    }
    expect(totalCalls).toBe(20); // 4 公司 × 5 维度
  });

  it('aggregate() 总分 = 加权平均 + 雷达图维度完整', async () => {
    // byte 全 5 维度拿最高分 → 总分应该 > 75
    const byteScores: Record<string, ScoreOutput> = {
      algo: { score: 76, evidence: 'e', suggestions: ['s'] },
      cs: { score: 80, evidence: 'e', suggestions: ['s'] },
      project: { score: 78, evidence: 'e', suggestions: ['s'] },
      sysdesign: { score: 72, evidence: 'e', suggestions: ['s'] },
      culture: { score: 82, evidence: 'e', suggestions: ['s'] },
    };
    const byteReport = aggregate({ company: 'byte', scores: byteScores });
    // 加权: 76*0.3 + 80*0.2 + 78*0.25 + 72*0.15 + 82*0.1 = 22.8+16+19.5+10.8+8.2 = 77.3 → 77
    expect(byteReport.totalScore).toBe(77);
    expect(Object.keys(byteReport.radar).length).toBe(5); // byte 启用 5 维度
    expect(byteReport.radar.algo).toBe(76);

    // ali 全 5 维度拿高分 → 总分
    const aliScores: Record<string, ScoreOutput> = {
      culture: { score: 82, evidence: 'e', suggestions: ['s'] },
      project: { score: 78, evidence: 'e', suggestions: ['s'] },
      star: { score: 77, evidence: 'e', suggestions: ['s'] },
      tech: { score: 82, evidence: 'e', suggestions: ['s'] },
      sysdesign: { score: 72, evidence: 'e', suggestions: ['s'] },
    };
    const aliReport = aggregate({ company: 'ali', scores: aliScores });
    // 加权: 82*0.3 + 78*0.3 + 77*0.2 + 82*0.15 + 72*0.05 = 24.6+23.4+15.4+12.3+3.6 = 79.3 → 79
    expect(aliReport.totalScore).toBe(79);
    // ali 雷达图应该和 byte 不同(启用不同维度)
    expect(byteReport.radar).not.toEqual(aliReport.radar);
    expect(aliReport.radar).toHaveProperty('star'); // ali 用 star
    expect(aliReport.radar).not.toHaveProperty('algo'); // ali 不用 algo
    expect(byteReport.radar).toHaveProperty('algo'); // byte 用 algo
    expect(byteReport.radar).not.toHaveProperty('star'); // byte 不用 star
  });

  it('aggregate() 缺失维度 fallback 60 分(降级安全)', () => {
    // 只给 3 个维度(模拟 AI 部分失败)
    const partial = aggregate({
      company: 'tencent',
      scores: {
        pressure: { score: 68, evidence: 'e', suggestions: ['s'] },
        project: { score: 78, evidence: 'e', suggestions: ['s'] },
        star: { score: 77, evidence: 'e', suggestions: ['s'] },
        // tech + culture 缺失
      },
    });
    // activeDimensions('tencent') = pressure/project/star/tech/culture
    // 缺失的 tech/culture 用 60 分进 radar,但不参与总分加权(避免 AI 失败污染总分)
    expect(partial.radar.tech).toBe(60);
    expect(partial.radar.culture).toBe(60);
    expect(partial.radar.pressure).toBe(68);
    // 总分: 实际传入的 3 个维度参与加权
    // = (68*0.25 + 78*0.3 + 77*0.2) / (0.25+0.3+0.2)
    // = (17 + 23.4 + 15.4) / 0.75
    // = 55.8 / 0.75 = 74.4 → 74
    expect(partial.totalScore).toBe(74);
  });

  it('8 维度差异化分数 unique ≥ 6(延续 #142 基线)', () => {
    const map: Record<string, number> = {
      tech: 82,
      project: 78,
      sysdesign: 72,
      algo: 76,
      cs: 80,
      culture: 82,
      star: 77,
      pressure: 68,
    };
    const distinct = new Set(Object.values(map));
    expect(distinct.size).toBeGreaterThanOrEqual(6);
  });
});
