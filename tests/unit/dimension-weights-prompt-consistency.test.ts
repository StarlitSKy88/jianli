/**
 * 防御性测试 — DIMENSION_WEIGHTS × 评分 prompt 文件系统一致性
 *
 * 背景（Bug-029 / zhangwei-report §6.1）：
 *   - 2026-07-19 prod 真实缺陷：`/api/interview/[id]/message` finish 触发评分时，
 *     `[scorer-prompt-loader] 找不到评分 prompt: tencent/star` 抛 STREAM_ERROR
 *   - 根因：`.knowledge/agents/scorer/{company}/{dimension}.md` 文件系统
 *     与 `lib/scoring/dimensions.ts#DIMENSION_WEIGHTS` 静态配置脱节
 *   - 修复（commit 272db21）：补全 tencent/star.md 等文件
 *
 * 防御：本测试在编译期+运行时校验两者一致性：
 *   1. DIMENSION_WEIGHTS 中所有 weight > 0 的 (company, dimension)
 *      必须有对应 .md 文件
 *   2. 所有 .md 文件的 front-matter dimension 必须在白名单
 *   3. 所有 .md 文件的 weight 字段必须在 0-1 之间
 *
 * 失败 = 立即 build error，避免 finish 触发时才 STREAM_ERROR
 *
 * Why this exists:
 *   单 Agent 写代码只是"加东西"，本测试是"让系统从此变聪明"
 *   下次有人给某公司加非零权重维度忘了建 prompt 文件，
 *   pnpm test 立即失败 — 而不是等 prod 用户跑到 finish 才看到空白报告
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { DIMENSION_WEIGHTS } from '@/lib/scoring/dimensions';
import { COMPANY_VALUES } from '@/lib/scoring/prompt-loader';

// 本地白名单镜像 prompt-loader.ts 的 DIMENSION_VALUES，避免依赖未导出符号
const DIMENSION_WHITELIST = [
  'tech',
  'project',
  'sysdesign',
  'algo',
  'cs',
  'culture',
  'star',
  'pressure',
] as const;

const ROOT = path.resolve(process.cwd(), '.knowledge', 'agents', 'scorer');
const MAX_FILE_SIZE = 64 * 1024;

describe('Bug-029 defense: DIMENSION_WEIGHTS × 评分 prompt 文件系统一致性', () => {
  it('DIMENSION_WEIGHTS 权重总和 = 1.0（每家公司）', () => {
    for (const [company, weights] of Object.entries(DIMENSION_WEIGHTS)) {
      const sum = Object.values(weights).reduce((s, w) => s + w, 0);
      expect(Math.abs(sum - 1), `${company} 权重总和 = ${sum}, 期望 = 1.0`).toBeLessThan(0.001);
    }
  });

  it('DIMENSION_WEIGHTS 中所有 weight > 0 的 (company, dimension) 必须有对应 .md 文件', () => {
    const missing: string[] = [];

    for (const company of COMPANY_VALUES) {
      const weights = DIMENSION_WEIGHTS[company as keyof typeof DIMENSION_WEIGHTS];
      for (const dim of DIMENSION_WHITELIST) {
        const w = weights[dim as keyof typeof weights];
        if (w <= 0) continue; // 权重为 0 的维度不要求 prompt

        const filePath = path.join(ROOT, company, `${dim}.md`);
        if (!fs.existsSync(filePath)) {
          missing.push(
            `${company}/${dim} (weight=${w}, 期望文件: ${path.relative(process.cwd(), filePath)})`
          );
        }
      }
    }

    expect(
      missing,
      `\n❌ Bug-029 复发！以下 (company, dimension) 组合 weight > 0 但缺少 prompt 文件:\n  ${missing.join('\n  ')}\n` +
        `\n修复方法: 在 .knowledge/agents/scorer/{company}/{dimension}.md 创建文件\n` +
        `参考已有文件格式: front-matter (company/dimension/name/version/weight) + body\n`
    ).toEqual([]);
  });

  it('.md 文件 front-matter 的 company 字段必须与目录名一致', () => {
    const violations: string[] = [];

    for (const company of COMPANY_VALUES) {
      const dir = path.join(ROOT, company);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = matter(content);
        if (parsed.data.company !== company) {
          violations.push(`${company}/${file}: front-matter.company = "${parsed.data.company}"`);
        }
      }
    }

    expect(violations, `\nfront-matter 与路径不一致:\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('.md 文件 front-matter 的 dimension 字段必须在白名单 8 维度内', () => {
    const violations: string[] = [];
    const whitelist = new Set<string>(DIMENSION_WHITELIST);

    for (const company of COMPANY_VALUES) {
      const dir = path.join(ROOT, company);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = matter(content);
        const declaredDim = parsed.data.dimension as string;
        // 文件名应与 front-matter.dimension 一致，且都在白名单内
        if (!whitelist.has(declaredDim)) {
          violations.push(`${company}/${file}: front-matter.dimension "${declaredDim}" 不在白名单`);
        }
      }
    }

    expect(
      violations,
      `\n以下 .md 文件 dimension 不在 8 维度白名单内:\n  ${violations.join('\n  ')}`
    ).toEqual([]);
  });

  it('.md 文件 weight 字段必须在 [0, 1] 范围内', () => {
    const violations: string[] = [];

    for (const company of COMPANY_VALUES) {
      const dir = path.join(ROOT, company);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = matter(content);
        const w = parsed.data.weight;
        if (typeof w !== 'number' || w < 0 || w > 1) {
          violations.push(`${company}/${file}: weight = ${w} (期望 0-1)`);
        }
      }
    }

    expect(violations, `\nweight 字段非法:\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('.md 文件大小 ≤ 64KB', () => {
    const violations: string[] = [];

    for (const company of COMPANY_VALUES) {
      const dir = path.join(ROOT, company);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(dir, file);
        const size = fs.statSync(filePath).size;
        if (size > MAX_FILE_SIZE) {
          violations.push(`${company}/${file}: ${size}B (max ${MAX_FILE_SIZE}B)`);
        }
      }
    }

    expect(violations, `\n文件过大:\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('每个 .md 文件 body 必须包含"红线"或"35+"合规声明', () => {
    const violations: string[] = [];

    for (const company of COMPANY_VALUES) {
      const dir = path.join(ROOT, company);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = matter(content);
        const body = parsed.content;
        const ok = body.includes('红线') || body.includes('35+');
        if (!ok) {
          violations.push(`${company}/${file}: 缺少红线/35+ 合规声明`);
        }
      }
    }

    expect(violations, `\n缺少合规声明:\n  ${violations.join('\n  ')}`).toEqual([]);
  });
});

/**
 * 关键场景回归测试 — 直接复现 zhangwei-report §6.1
 *
 * 场景：腾讯 P5 finish 触发评分，5 个非零维度都应能加载
 * 失败 = Bug-029 复发（STREAM_ERROR 阻断报告生成）
 */
describe('Bug-029 regression: 腾讯 P5 评分 prompt 全员就绪', () => {
  it('腾讯 P5 (pressure/project/star/tech/culture) 5 维度 prompt 都可加载', () => {
    const tencentActive: Array<[string, number]> = Object.entries(DIMENSION_WEIGHTS.tencent)
      .filter(([, w]) => w > 0)
      .map(([d, w]) => [d, w]);

    // 腾讯 P5 应有 5 个非零维度
    expect(tencentActive.length, '腾讯 P5 应有 5 个非零维度').toBe(5);

    for (const [dim, w] of tencentActive) {
      const filePath = path.join(ROOT, 'tencent', `${dim}.md`);
      expect(
        fs.existsSync(filePath),
        `tencent/${dim}.md (weight=${w}) 必须存在 — Bug-029 复发！`
      ).toBe(true);
    }
  });

  it('所有公司所有非零维度的 .md 都存在 (4 公司 × ~5 维度 ≈ 20 个)', () => {
    let total = 0;
    for (const company of COMPANY_VALUES) {
      const weights = DIMENSION_WEIGHTS[company as keyof typeof DIMENSION_WEIGHTS];
      for (const w of Object.values(weights)) {
        if (w > 0) total++;
      }
    }
    expect(total, '应有 20 个非零维度组合').toBe(20);

    let exists = 0;
    for (const company of COMPANY_VALUES) {
      const weights = DIMENSION_WEIGHTS[company as keyof typeof DIMENSION_WEIGHTS];
      for (const dim of DIMENSION_WHITELIST) {
        const w = weights[dim as keyof typeof weights];
        if (w > 0 && fs.existsSync(path.join(ROOT, company, `${dim}.md`))) {
          exists++;
        }
      }
    }
    expect(exists, `期望 ${total} 个文件全部存在`).toBe(total);
  });
});
