---
id: bugs-2026-07-23-transcript-cap
title: transcript.max(50) zod schema 阻止 26+ 轮对话触发评分
category: bugs
severity: critical
tags: [scoring, zod, schema, transcript, validation]
created_at: 2026-07-23
project: interview-buddy

problem: |
  lib/scoring/dimensions.ts line 86:
  ```typescript
  transcript: z.array(...).max(50), // 单维度评分最多看 50 条对话
  ```

  但完整面试流程:
  - 1 轮 = 1 条 user + 1 条 assistant = **2 条消息**
  - 30 轮 = 60 条 > 50
  - 26 轮 = 52 条 > 50

  **结果**:任何 ≥26 轮对话触发 /api/interview/[id]/complete 时,
  scoreOne 调 ScoreInputSchema.parse() throws zod error,
  catch 块兜底返回 score=60,所有维度都是兜底分。

  **生产影响**:MVP 设计就是 30 轮对话,**所有真实用户的评分都是 60 兜底**。
  Bug 静默存在(用户看不到 zod error,只看到 "总分 60")。

  复现:
  - curl POST /api/interview/{id}/complete 26 轮对话
  - response.scoringError = `[{"code":"too_big","maximum":50,"path":["transcript"]}]`
  - report.dimensionScores 全是 60

solution: |
  把 max(50) 改 max(100),留 buffer 给 40-50 轮对话:

  ```typescript
  // lib/scoring/dimensions.ts line 86
  .max(100), // 单维度评分最多看 100 条对话(Round 5 Bug-007:30 轮 = 60 条,50 太严)
  ```

  **为什么 100 不是 50**:
  - MVP 默认 30 轮对话 = 60 条
  - 留 40 条 buffer 给深度追问(用户反复讨论某个项目)
  - 50 太严,稍长的面试就触发

  **为什么不删 max**:LLM context window 有限,太多对话浪费 token。
  100 是合理上限(对应 ~50 轮 + 50% 追问余量)。

verification:
  unit: "zod schema 验证不再 throw"
  integration: "byte P7 26 轮 → totalScore=77,5 维度差异化"
  e2e: "curl /complete 完整 26 轮 → report 入库,score 真实差异化"

learned_from:
  - file: lib/scoring/dimensions.ts
  - test: tests/unit/scoring-differentiation.test.ts
  - commit: TBD

debugging_trace: |
  1. Round 5 跑 phase-14-2 30 轮,SCORE=0 报告不存在
  2. curl /complete 直接调 → scoringError 含 "too_big maximum:50"
  3. 读 dimensions.ts:86 发现 max(50)
  4. 26 轮 (52 条) > 50 → 必然 throw
  5. 改 max(100),重启 dev server,重跑 → score 真实入库

anti_pattern: |
  **禁止 schema 限制 < 真实业务最大值**:MVP 设计 30 轮对话,
  schema 上限 50 = 一开始就注定 prod 失败。

  **禁止兜底路径 silent failure**:catch 返回 score=60 没 log 业务事件,
  PM 看不到"评分全部失败",只看到"所有人都 60 分"。

follow_up:
  - 加业务事件:scoring 全兜底时 emit `scoring_all_fallback` 给监控
  - 改 phase-14-2 脚本:先做 1 轮 test score 看是否真进入评分路径,再跑 30 轮
  - 把 "transcript max" 加入 CI gate:任何 PR 改 schema 必跑 stress 30 轮