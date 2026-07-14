---
id: pattern-2026-07-14-001
title: Zod partial() 与 enum 的陷阱 — 默认值要手动补
category: pattern
severity: medium
tags: [zod, schema, partial, fallback, prisma]
created_at: 2026-07-14
project: interview-buddy

problem: |
  想给 AI 输出做"宽松 fallback"，常用 `.partial()` 让所有字段可选：
  ```ts
  const fallback = InterviewerOutputSchema.partial().parse({ question: '...' });
  ```
  **报错**：`dimension` 是 enum，partial 后仍要求是合法 enum 值（不允许 undefined）。
  即使 `.partial()` 让 key 可选，enum 也不接受 `undefined`。

  同类陷阱：
  - Prisma schema 字段名 ≠ 业务名（如 `Report.dimensionScores` 不是 `radar`）
  - `Report` 没有 `scores` 关联，正确的关联名是 `agentScores`

solution: |
  1. **Fallback 直接构造对象**，不用 schema 校验：
     ```ts
     return { question: cleaned, dimension: 'tech', phase: 'deep' };
     ```
  2. **Prisma 字段名**以 `prisma/schema.prisma` 为准 — 不要靠记忆
  3. **关联名**用 `<model>.<fieldName>` 查 Prisma schema
  4. **PII 红线**不能被 try/catch 吞掉 — 必须显式 rethrow

verification:
  unit: "vitest 52/52 pass — Phase 5 全部稳定"
  e2e: "未测"
  typecheck: "tsc --noEmit 0 errors"

learned_from:
  - file: lib/agents/interviewer/index.ts (parseOutput fallback)
  - file: lib/scoring/scorer.ts (PII rethrow)
  - file: lib/scoring/persist.ts (Prisma 字段对齐)
  - file: prisma/schema.prisma
---

# 经验教训

**Zod partial() 不接受 enum 的 undefined** —— 一旦走 fallback，要么直接构造对象，要么用 `.optional()` 显式标注每个字段。

**Prisma schema 是 single source of truth** —— 写持久化时先 `grep model` 看字段名。关联用 `modelName.fieldName`（如 `agentScores` 不是 `scores`）。

**PII 红线永远 rethrow** —— try/catch 兜底很容易把安全错误"静默化"。在 catch 开头先判断是否是 PII 错误，是就 rethrow。