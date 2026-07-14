---
id: pattern-2026-07-14-002
title: Prisma schema 是 single source of truth — 别靠记忆
category: pattern
severity: medium
tags: [prisma, schema, alignment, refactor]
created_at: 2026-07-14
project: interview-buddy

problem: |
  Phase 7 写 API 时连续踩 Prisma schema 字段名不一致：
  1. RateLimit: 业务命名 `action + date` → schema 是 `resourceType + windowStart`
  2. TrackEvent: 业务命名 `event + props` → schema 是 `eventName + properties`
  3. Report: 业务命名 `radar + weak + strong` → schema 是 `dimensionScores + improvements`
  4. AgentScore: 业务命名 `dimension + score + evidence + suggestions` → schema 是 `agentName + dimensionScores + reasoning`
  5. Scenario: 创建时漏填 `interviewerPrompt + scoringWeights + difficultyPrompt`（schema 强制 NOT NULL）
  6. Message: role 业务用 `ASSISTANT` → schema enum 是 `INTERVIEWER`；Message 没有 `dimension/phase` 字段
  7. Interview: 漏填 `resumeId`（schema NOT NULL）；status 业务用 `ACTIVE` → schema enum 是 `IN_PROGRESS`；时间字段是 `startedAt` 不是 `createdAt`

solution: |
  **铁律**：写持久化层前先 `grep -A 20 "model <ModelName>"` 看 schema 字段定义。

  实战清单（按本次踩坑顺序）：
  1. 所有 enum 取值大小写必须对齐（Postgres 默认大写）
  2. 时间字段：业务命名 ≠ schema 命名（createdAt vs startedAt）
  3. JSON 字段：业务叫 radar/weak/strong，schema 统一叫 dimensionScores + improvements
  4. NOT NULL 字段必须填 — 哪怕是占位符（interviewerPrompt/difficultyPrompt）
  5. 关联名是 `<model>.<fieldName>`（如 `agentScores` 不是 `scores`）

  建议：在 persist 层加一行 zod schema 校验 → Prisma schema 的转换层，单测覆盖。

verification:
  unit: "vitest 57/57 pass — Phase 7 全部稳定"
  typecheck: "tsc --noEmit 0 errors"
  integration: "API routes 全部对齐 Prisma schema"

learned_from:
  - file: lib/scoring/persist.ts
  - file: app/api/interview/route.ts
  - file: app/api/interview/[id]/message/route.ts
  - file: lib/utils/rate-limit.ts
  - file: lib/analytics/track.ts
  - file: prisma/schema.prisma
---

# 经验教训

**Prisma schema 不是文档，是编译器的一部分。**

写代码时 `tsc` 会强制约束字段名 —— 这就是为什么"先 type-check 再继续"能避免 80% 的 Prisma 字段名错误。

**固化流程**：
1. 写完 model/service → 跑 type-check → 看报错
2. 报错不是"设计问题"，而是"业务命名与 schema 命名未对齐"
3. 改业务代码，**不**改 schema（除非真的业务变化）
4. 重跑 type-check → 0 errors → 单测 → 全套验证

**这条经验说明**：TypeScript + Prisma 的组合实际上非常安全，但前提是你愿意"先 type-check 再提交"。如果跳过这步，bug 会推迟到运行时才暴露。