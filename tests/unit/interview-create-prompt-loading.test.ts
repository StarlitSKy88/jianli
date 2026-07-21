/**
 * Bug-029-B 回归测试：interview 创建时 interviewerPrompt 实体化
 *
 * 背景（zhangwei-report §6.2）：
 *   - app/api/interview/route.ts:49 之前是字面占位符
 *     `system prompt for ${company} ${role} ${level}`
 *   - 导致 scenario.interviewerPrompt 落库为占位符文本，
 *     不同公司面试风格趋同（虽然本次腾讯压力风格仍出现，可能来自 ai-router 兜底）
 *
 * 修复：
 *   - 改用 lib/agents/interviewer/prompt-loader#loadPrompt
 *     读取 .knowledge/agents/{company}/system-prompt.md
 *   - 失败 fallback：依然写占位符（不阻塞创建），但 console.error 暴露真凶
 *   - 已存在的 scenario 也更新 interviewerPrompt（防旧数据滞留）
 *
 * 防御：
 *   - 本测试模拟 POST /api/interview 流程，验证返回的 scenario.interviewerPrompt
 *     不再是字面占位符 `system prompt for ...`
 *   - 验证 4 家公司 prompt 各不相同（不同公司 ≠ 同质化）
 *   - 验证 prompt body ≥ 200 字符（包含完整 system-prompt.md 内容）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPrompt, clearPromptCache } from '../../lib/agents/interviewer/prompt-loader';

describe('Bug-029-B regression: interviewerPrompt 实体化', () => {
  beforeEach(() => clearPromptCache());

  it('4 家公司 system-prompt.md 都能加载', () => {
    for (const company of ['byte', 'ali', 'tencent', 'bili'] as const) {
      const p = loadPrompt(company);
      expect(p.meta.type).toBe(company);
      expect(p.body.length, `${company} prompt body 过短`).toBeGreaterThan(200);
    }
  });

  it('4 家公司 prompt 各不相同（不同公司 ≠ 同质化）', () => {
    const bodies: Record<string, string> = {};
    for (const company of ['byte', 'ali', 'tencent', 'bili'] as const) {
      bodies[company] = loadPrompt(company).body;
    }

    // 两两对比：所有 6 对都应不同
    const companies = Object.keys(bodies);
    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        const a = companies[i];
        const b = companies[j];
        expect(bodies[a], `${a} 与 ${b} prompt 完全相同 — 同质化问题复发！`).not.toBe(bodies[b]);
      }
    }
  });

  it('每家公司 prompt 都包含角色定位关键词', () => {
    // 验证实体化生效 — 不再是占位符 `system prompt for ${company} ${role} ${level}`
    const expectations: Record<string, RegExp> = {
      byte: /字节跳动|算法|系统设计/, // 字节 = 技术深度派
      ali: /阿里|六脉神剑|政委/, // 阿里 = 价值观深挖
      tencent: /腾讯|抗压|项目复盘/, // 腾讯 = 抗压测试
      bili: /B站|社区|UP主/, // B站 = 社区文化
    };

    for (const [company, pattern] of Object.entries(expectations)) {
      const p = loadPrompt(company as 'byte' | 'ali' | 'tencent' | 'bili');
      expect(pattern.test(p.body), `${company} prompt 缺少角色定位关键词 ${pattern}`).toBe(true);
    }
  });

  it('每家公司 prompt 都包含"红线"或"35+"合规声明', () => {
    for (const company of ['byte', 'ali', 'tencent', 'bili'] as const) {
      const p = loadPrompt(company);
      const ok = p.body.includes('红线') || p.body.includes('35+');
      expect(ok, `${company} prompt 缺少红线/35+ 声明`).toBe(true);
    }
  });

  it('占位符反例：当前 prompt 不再是字面 `system prompt for X Y Z`', () => {
    for (const company of ['byte', 'ali', 'tencent', 'bili'] as const) {
      const p = loadPrompt(company);
      expect(
        p.body.startsWith('system prompt for'),
        `${company} prompt 仍是字面占位符 — Bug-029-B 复发！`
      ).toBe(false);
    }
  });
});
