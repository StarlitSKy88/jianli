---
id: bugs-2026-07-23-mock-not-forced
title: USE_MOCK_AI=1 没强制只用 mock,真实 AI 返回 <think> CoT 污染评分
category: bugs
severity: high
tags: [mock, ai, router, env, test-env]
created_at: 2026-07-23
project: interview-buddy

problem: |
  lib/ai/router.ts 行为:
  ```typescript
  const allProviders = enabledProviders();  // mock 加入候选池但 priority=99
  const available = filterAvailable(allProviders, now);  // mock 与真实 provider 都保留
  // 按 priority 升序遍历
  for (const p of available) {
    const result = await p.chat(messages, opts);  // 第一个成功的为准
    return result;
  }
  ```

  USE_MOCK_AI=1 的预期:"只用 mock,隔离真实 AI quota"。
  实际行为:mock 只是被加入候选池,但 minimax/deepseek 没 cooldown 时
  按 priority 排序(1 vs 99)先被调用,**真实 AI 直接返回 <think>...CoT 文本**,
  scorer 当 JSON parse 失败 → 兜底 60 分。

  复现:
  - export USE_MOCK_AI=1 pnpm dev
  - /api/health → mockEnabled:true
  - 评分调用 → minimax 返回 <think>The candidate...CoT 文本
  - scorer 输出非 JSON → fallback 60 分

  **影响**:Phase 14.4 mock 验证一直说"成功"是因为 dev hint 错误,
  真实 prod 环境下 USE_MOCK_AI=1 完全不能阻止真实 AI 调用。

solution: |
  router 顶层加 USE_MOCK_AI=1 短路:

  ```typescript
  // lib/ai/router.ts (after filterAvailable)
  if (process.env.USE_MOCK_AI === '1' && !opts?.provider) {
    const mockOnly = available.filter((p) => p.name === 'mock');
    if (mockOnly.length === 0) {
      throw new Error('USE_MOCK_AI=1 但 mock provider 不可用');
    }
    available = mockOnly;
    console.info(`[ai-router] USE_MOCK_AI=1 → 强制只用 mock`);
  }
  ```

  **为什么这样改**:
  - USE_MOCK_AI=1 的语义本来就是"完全用 mock,不再回退到真实"
  - opts.provider=mock 仍然可以走 fallback(给 anchor-vs-ai.ts 这种工具用)
  - 测试/CI 环境 USE_MOCK_AI=1 现在真的只跑 mock

  **为什么保留 fallback 路径**:
  - mock 抛错时(理论上不应该),仍允许回退到真实 AI 保证可用性
  - 但实际上 mock 不该抛错,这里只是防御性编程

verification:
  unit: "router USE_MOCK_AI=1 短路逻辑单测"
  integration: "byte P7 26 轮 → totalScore=77,5 维度差异化(证明 mock 真的用了)"
  e2e: "curl /complete 报 report 入库,evidence 是中文(不是 <think> CoT)"

learned_from:
  - file: lib/ai/router.ts
  - test: tests/unit/scoring-differentiation.test.ts
  - commit: TBD

debugging_trace: |
  1. Round 5 修完 Bug-007 后,complete 返回 totalScore=60 还是兜底
  2. tail dev log: "[scorer] 输出非 JSON: <think>The candidate..."
  3. 真实 AI 返回的,不是 mock
  4. /api/health → mockEnabled:true 但 router 还是选 minimax
  5. 读 router.ts:filterAvailable 不过滤 mock,然后按 priority 调用
  6. 加 USE_MOCK_AI=1 短路 → 重启 dev → 重跑 → score=77 ✅

anti_pattern: |
  **禁止"加候选池"≠"强制使用"**:USE_MOCK_AI=1 应该是硬隔离,
  不是软开关。任何 prod-like 行为(真实 AI)都应该被它阻断。

  **禁止 dev hint 掩盖问题**:`mockEnabled:true` 在 health response 里,
  但 router 行为不一致 → 误导 PM 以为"已经在用 mock"。

follow_up:
  - /api/health 加更明确的 router 状态:`routerMode: "mock-only" | "real-only" | "fallback"`
  - 给 router 行为写端到端测试:USE_MOCK_AI=1 时无论真实 AI 是否可用,只用 mock
  - 文档化 USE_MOCK_AI 的真实语义(现在是"强制只用 mock"不再是"启用 mock 候选")