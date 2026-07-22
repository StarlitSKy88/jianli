---
id: bugs-2026-07-23-mock-dim-extract
title: mock AI 评分维度提取被 prompt body 标题干扰,返回错的分数
category: bugs
severity: high
tags: [mock, ai, scoring, regex, prompt-body]
created_at: 2026-07-23
project: interview-buddy

problem: |
  mock provider 用 `.match(/评分维度[：:]\s*(\w+)/)` 提取 system 里的 dimension
  关键词,但 prompt body(如 ali/star.md 第一行 "# 评分维度：STAR 行为面试（阿里）")
  会先匹配到非维度词,导致 mock 返回错的 score。

  复现:
  - ali/star prompt body 含 "# 评分维度：STAR 行为面试"
  - system 末尾含 "- 评分维度：star" (任务上下文,权威值)
  - mock `.match()` 返回第一个匹配 → "STAR" → map 找不到 → fallback 到 tech(82)
  - 实际应该返回 star(77)

  影响:Round 5 测试发现 ali/star 期望 77 实际 82, byte/algo/culture 等也可能受影响。
  任何带"评分维度：xxx 描述"标题的 prompt body 都会误匹配。

solution: |
  改用 matchAll + 取最后一个匹配:

  ```typescript
  // lib/ai/providers/mock.ts
  function extractDimensionFromSystem(systemPrompt: string): Dimension | null {
    const matches = [...systemPrompt.matchAll(/评分维度[：:]\s*(\w+)/g)];
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1][1];
    return last in MOCK_SCORE_BY_DIMENSION ? (last as Dimension) : null;
  }
  ```

  **为什么取最后一个**:任务上下文里的"评分维度：${dim}"是权威值,
  prompt body 里的描述(中文/混合)在前,不参与打分逻辑。

  **测试 mock 函数同步修复**:tests/unit/scoring-differentiation.test.ts 的
  makeMockScoreContent 也用 matchAll,保证 mock 行为一致。

verification:
  unit: "vitest 232/232 (新增 scoring-differentiation.test.ts 5/5 passed)"
  integration: "字节 byte P7 26 轮 → totalScore=77,5 维度差异(76/80/82/78/72)"
  e2e: "端到端 curl /api/interview/[id]/report 返回真实差异化分数"

learned_from:
  - file: lib/ai/providers/mock.ts
  - test: tests/unit/scoring-differentiation.test.ts
  - commit: TBD

debugging_trace: |
  1. Round 5 写 20 组合差异化测试,跑出 ali/star 期望 77 但得 82
  2. 调 makeMockScoreContent 直接看实际 system prompt
  3. node 验证:真实 ali/star system 含两个"评分维度："(STAR 和 star)
  4. 第一个匹配是 STAR(中文描述),map["STAR"]=undefined → fallback tech=82
  5. 修复:取最后一个匹配 → 任务上下文的 star 优先

anti_pattern: |
  **禁止用 `.match()` 第一个匹配做权威提取**:prompt 任何含目标关键词的
  标题/描述都会污染提取。要么用 lastIndexOf 类逻辑,要么用更精确的锚点(行号)。

follow_up:
  - 加 lint 规则:禁止在 prompt body 第一行用"评分维度："(除非是任务上下文)
  - 考虑给 mock 提取逻辑加 unit test(目前只覆盖在 integration 测试里)