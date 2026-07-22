---
id: patterns-2026-07-23-8991
title: 复利工程四步循环(PLAN-EXECUTE-REVIEW-COMPOUND)在小项目实战模板
category: patterns
severity: medium
tags: [workflow, plan-execute-review-compound, methodology, small-project]
created_at: 2026-07-23
project: interview-buddy

problem: |
  小型项目(20-30 API 路由 / 单人维护)如何套用"复利工程四步循环"?
  原方案是 26 Agent + 14 并行审查 + 6 子 Agent 固化,对我们过度设计。

  实战痛点:
  - 没那么多 bug 需要 14 个 reviewer 盯着
  - 单人项目不需要 business-x / i18n-x 等垂直专家
  - 但又不能"回到写完即忘"的旧模式

solution: |
  ## 简化版四步循环(小型项目适配)

  ### 1. PLAN (20% 时间) — 列清单
  ```markdown
  - [ ] 改 X 文件,删 Y 文件
  - [ ] 验证: 单测 A / 集成 B / E2E C
  - [ ] 风险评估
  - [ ] 固化计划: 本次会写几张 .knowledge/ 卡
  ```

  ### 2. EXECUTE (20% 时间) — 严格按 plan
  - 改一行测一行,不要憋大改
  - 用 Edit 不用 Write(避免无意中覆盖)

  ### 3. REVIEW (30% 时间) — 三层验证
  - 自审(主线程)
  - `pnpm review <path>`(自动选 1-4 agent)
  - 跑回归:`pnpm test` + `pnpm type-check` + 端到端脚本

  ### 4. COMPOUND (30% 时间) — 不依赖记忆
  - 修完 prod bug **立刻** `pnpm compound "<问题>"`
  - 自动化问答生成 YAML 骨架
  - 填内容 + git commit + push
  - 更新 CLAUDE.md 状态表

  ## Agent 并行 — 按需 2-4 个

  | 触发条件 | 派出 Agent |
  |---|---|
  | 改 /auth/ /payment/ | code-reviewer + security-reviewer |
  | 改 /scoring/ /ai/ | code-reviewer + tdd-guide |
  | 普通改 | code-reviewer (1 个) |
  | `--deep` | code-reviewer + security + tdd + refactor-cleaner |

  **不要**:
  - ❌ 14 个 reviewer 全跑(浪费 80% token,7/14 永远说"没问题")
  - ❌ 跳过 COMPOUND 阶段(下次踩同一个坑)
  - ❌ "修完就完事"心态(熵增第一定律)

verification:
  unit: "Round 4 实战: 1 loop 修 2 bug + 1 重构 + 8 单测"
  integration: "compound.sh + review.sh v0.1 命令可调用"
  e2e: "5 个端到端脚本(mock-user-e2e/boundary/admin-e2e/...)"

learned_from:
  - file: scripts/compound.sh
  - file: scripts/review.sh
  - commit: 0ed9623 / 4031f69

debugging_trace: |
  Round 1-3 实战证明四步循环可行:
  - Round 1: 10 用户压测 → 发现 Bug-001 (register cookie)
  - Round 2: 10 画像全过,无新 bug
  - Round 3: 10 边界全过 → 发现 Bug-002 (existing check 顺序)
  - Round 4: Admin 流程 → 发现 Bug-003 (鉴权绕过) + Bug-004 (大小写不一致,DRY 提取时浮出)
  - 总产出: 4 commits, 4 bug cards, 8 unit tests, 4 e2e scripts

anti_pattern: |
  **禁止 14 Agent 盲目堆砌**:小项目用 14 agent 是过度工程,
  80% 的 agent 永远说"没问题",浪费 token + 训练 agent 偷懒。

  **禁止"修完就忘"**:修完 bug 不写卡 = 未来 100% 重复踩坑。
  COMPOUND 阶段不是可选项,是必选项。

  **禁止 PLAN 阶段省略风险评估**:改之前不知道会炸什么 = 改完祈祷不爆。

follow_up:
  - 下次任务继续套这个模板,观察是否真的能持续跑通
  - 考虑加 `pnpm retro` 命令做"每周复盘哪个环节拖后腿"
  - 累积 10 次循环后总结"哪些 bug 类型最常出现",针对性加 lint 规则