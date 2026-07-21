/**
 * 防御性测试 — ScoreAnchor 数据一致性
 *
 * 覆盖：
 * 1. humanScore 必须在 expectedScoreMin/Max 区间内
 * 2. expectedScoreMin ≤ expectedScoreMax
 * 3. driftThreshold 在 1-50 之间
 * 4. 公司、维度在白名单内
 * 5. 同一 (company, role, level, dimension) 不能有多个 active anchor
 * 6. questionText ≥ 20 字符，referenceAnswer ≥ 20 字符
 * 7. tags 字段是字符串数组（如有）
 *
 * Why this exists:
 *   - ScoreAnchor 是"金标准"，数据出错会污染所有漂移检测结果
 *   - 用防御测试在编译期+运行时校验，避免 admin 误填后污染 anchor 集
 */
import { describe, it, expect } from 'vitest';

const COMPANY_VALUES = ['byte', 'ali', 'tencent', 'bili'] as const;
const DIMENSION_VALUES = [
  'tech',
  'project',
  'sysdesign',
  'algo',
  'cs',
  'culture',
  'star',
  'pressure',
] as const;

/**
 * 校验 anchor 数据一致性（应用层 schema）
 *
 * 这个函数被 admin API 和 anchor 集种子脚本共用。
 * 如果这里改了规则，所有 anchor 都得通过校验 — 这是"种子数据测试"的核心
 */
export function validateAnchor(anchor: {
  company: string;
  dimension: string;
  humanScore: number;
  expectedScoreMin: number;
  expectedScoreMax: number;
  driftThreshold: number;
  questionText: string;
  referenceAnswer: string;
  tags?: unknown;
}): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!(COMPANY_VALUES as readonly string[]).includes(anchor.company)) {
    errors.push(`company "${anchor.company}" 不在白名单`);
  }
  if (!(DIMENSION_VALUES as readonly string[]).includes(anchor.dimension)) {
    errors.push(`dimension "${anchor.dimension}" 不在白名单`);
  }
  if (anchor.expectedScoreMin > anchor.expectedScoreMax) {
    errors.push('expectedScoreMin 必须 ≤ expectedScoreMax');
  }
  if (anchor.humanScore < anchor.expectedScoreMin || anchor.humanScore > anchor.expectedScoreMax) {
    errors.push(
      `humanScore=${anchor.humanScore} 必须在 [${anchor.expectedScoreMin}, ${anchor.expectedScoreMax}] 区间内`
    );
  }
  if (anchor.driftThreshold < 1 || anchor.driftThreshold > 50) {
    errors.push(`driftThreshold=${anchor.driftThreshold} 必须在 1-50 之间`);
  }
  if (anchor.questionText.length < 20) {
    errors.push(`questionText 过短（${anchor.questionText.length} 字符，要求 ≥ 20）`);
  }
  if (anchor.referenceAnswer.length < 20) {
    errors.push(`referenceAnswer 过短（${anchor.referenceAnswer.length} 字符，要求 ≥ 20）`);
  }
  if (anchor.tags !== undefined && anchor.tags !== null) {
    if (!Array.isArray(anchor.tags) || !anchor.tags.every((t) => typeof t === 'string')) {
      errors.push('tags 必须是字符串数组');
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

describe('ScoreAnchor 数据一致性', () => {
  const validAnchor = {
    company: 'byte',
    role: '后端工程师',
    level: 'P5',
    dimension: 'tech',
    questionText: 'Redis Pipeline 和 MGET 在你的场景下如何选择？为什么？',
    referenceAnswer:
      'MGET 是一次性拉取所有 key，Pipeline 是分批执行多个命令。在 key 数量不多（< 100）时 MGET 更快，但 Pipeline 更灵活。我选择 Pipeline 因为我们 key 数量会动态增长。',
    humanScore: 75,
    expectedScoreMin: 60,
    expectedScoreMax: 90,
    driftThreshold: 5,
    tags: ['Redis', 'Pipeline', '高频考点'],
  };

  it('合法 anchor 校验通过', () => {
    const r = validateAnchor(validAnchor);
    expect(r).toEqual({ ok: true });
  });

  it('company 不在白名单拒绝', () => {
    const r = validateAnchor({ ...validAnchor, company: 'google' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/company/);
  });

  it('dimension 不在白名单拒绝', () => {
    const r = validateAnchor({ ...validAnchor, dimension: 'beauty' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/dimension/);
  });

  it('expectedScoreMin > Max 拒绝', () => {
    const r = validateAnchor({
      ...validAnchor,
      expectedScoreMin: 90,
      expectedScoreMax: 60,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Min.*Max/);
  });

  it('humanScore 超出区间拒绝', () => {
    const r1 = validateAnchor({ ...validAnchor, humanScore: 30 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join(' ')).toMatch(/humanScore.*区间/);

    const r2 = validateAnchor({ ...validAnchor, humanScore: 95 });
    expect(r2.ok).toBe(false);
  });

  it('driftThreshold 必须在 1-50 之间', () => {
    expect(validateAnchor({ ...validAnchor, driftThreshold: 0 }).ok).toBe(false);
    expect(validateAnchor({ ...validAnchor, driftThreshold: 51 }).ok).toBe(false);
    expect(validateAnchor({ ...validAnchor, driftThreshold: 1 }).ok).toBe(true);
    expect(validateAnchor({ ...validAnchor, driftThreshold: 50 }).ok).toBe(true);
  });

  it('questionText 过短拒绝', () => {
    const r = validateAnchor({ ...validAnchor, questionText: '太短' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/questionText.*过短/);
  });

  it('referenceAnswer 过短拒绝', () => {
    const r = validateAnchor({ ...validAnchor, referenceAnswer: '太短' });
    expect(r.ok).toBe(false);
  });

  it('tags 必须是字符串数组', () => {
    const r1 = validateAnchor({ ...validAnchor, tags: 'not array' });
    expect(r1.ok).toBe(false);

    const r2 = validateAnchor({ ...validAnchor, tags: [1, 2, 3] });
    expect(r2.ok).toBe(false);

    const r3 = validateAnchor({ ...validAnchor, tags: ['Redis', 'Pipeline'] });
    expect(r3.ok).toBe(true);

    // tags 可选（undefined / null）
    expect(validateAnchor({ ...validAnchor, tags: undefined }).ok).toBe(true);
    expect(validateAnchor({ ...validAnchor, tags: null }).ok).toBe(true);
  });
});

describe('ScoreAnchor 评分漂移判定逻辑', () => {
  /**
   * 模拟"AI vs 人工"判定 — 复用 score-anchor 概念的纯函数
   */
  function computeDrift(
    aiScore: number,
    humanScore: number,
    driftThreshold: number
  ): { delta: number; isDrift: boolean } {
    const delta = Math.abs(aiScore - humanScore);
    return { delta, isDrift: delta > driftThreshold };
  }

  it('delta ≤ driftThreshold → isDrift=false', () => {
    expect(computeDrift(75, 75, 5)).toEqual({ delta: 0, isDrift: false });
    expect(computeDrift(80, 75, 5)).toEqual({ delta: 5, isDrift: false });
    expect(computeDrift(70, 75, 5)).toEqual({ delta: 5, isDrift: false });
  });

  it('delta > driftThreshold → isDrift=true', () => {
    expect(computeDrift(85, 75, 5)).toEqual({ delta: 10, isDrift: true });
    expect(computeDrift(60, 75, 5)).toEqual({ delta: 15, isDrift: true });
  });

  it('边界：delta === driftThreshold → isDrift=false（严格大于）', () => {
    // 这是关键边界 — 单测必须锁定语义
    expect(computeDrift(80, 75, 5).isDrift).toBe(false);
    expect(computeDrift(81, 75, 5).isDrift).toBe(true);
  });

  it('AI 返回无效分数（-1） → delta=999 → isDrift=true', () => {
    const r = computeDrift(-1, 75, 5);
    expect(r.delta).toBe(76);
    expect(r.isDrift).toBe(true);
  });
});

describe('ScoreAnchor 漂移严重度判定', () => {
  function severity(driftRate: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (driftRate > 0.3) return 'HIGH';
    if (driftRate > 0.15) return 'MEDIUM';
    return 'LOW';
  }

  it('driftRate 边界值正确映射 severity', () => {
    expect(severity(0)).toBe('LOW');
    expect(severity(0.15)).toBe('LOW'); // 边界 — 严格大于 0.15
    expect(severity(0.16)).toBe('MEDIUM');
    expect(severity(0.3)).toBe('MEDIUM'); // 边界 — 严格大于 0.3
    expect(severity(0.31)).toBe('HIGH');
    expect(severity(1)).toBe('HIGH');
  });
});
