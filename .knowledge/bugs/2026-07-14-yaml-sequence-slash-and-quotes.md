---
id: bug-2026-07-14-001
title: YAML 序列项含 / 或嵌套引号时 js-yaml 解析失败
category: bug
severity: medium
tags: [yaml, gray-matter, js-yaml, bili-prompt]
created_at: 2026-07-14
project: interview-buddy

problem: |
  .knowledge/agents/bili/system-prompt.md 的 YAML front-matter 解析失败：
  1. 序列项含 `/`（如 `ACG/泛二次元`）会被 js-yaml 当作结构分隔符
  2. 序列项含中文引号嵌套（如 `"年轻人才能懂 B 站"的偏见`）触发 bad indentation
  错误信息：
  - "bad indentation of a sequence entry at line 20, column 17"
  - 解析失败 → 整个 front-matter 被吃成空对象 → weights 全为 undefined
  - 单元测试 weights sum = 0（期望 ~1.0）

solution: |
  1. 序列项避免 `/`，如 `ACG 泛二次元知识`
  2. 序列项避免嵌套引号，如 `年轻人才能懂 B 站的偏见`（去掉引号）
  3. 兜底：在 prompt-loader.ts 增加容错：YAML 解析失败时仍返回 body，
     只 log warn，不让单条 prompt 拖垮整个面试官初始化
  4. 单元测试必须包含 weights sum 检查（能在第一秒发现此 bug）

verification:
  unit: "12/12 pass — pnpm vitest run tests/unit/prompt-loader.test.ts"
  e2e: "未测（仅单测覆盖）"
  typecheck: "tsc --noEmit 0 errors"

learned_from:
  - file: .knowledge/agents/bili/system-prompt.md
  - file: lib/agents/interviewer/prompt-loader.ts
  - commit: Phase 4.1 (待提交)
---

# 经验教训

YAML 看起来简单，但 js-yaml 3.x 对中文 + 特殊字符非常敏感。
**写 front-matter 的铁律**：
- 序列项只用纯中文 + 数字 + 空格
- 避免 `/` `:` `"` `'` 等结构符号
- 单元测试必须覆盖 weights sum 校验

**这条 bug 是单测救回来的**：weights sum = 0 一眼就发现。