---
id: bug-2026-07-21-029
title: 评分 prompt 文件系统 × DIMENSION_WEIGHTS 一致性缺陷 — 两层防御
category: bug
severity: high
status: fixed
tags: [scoring, prompt-loader, dim-weights, pii-red-line, prod-verify, defense-in-depth]
created_at: 2026-07-21
project: interview-buddy

problem: |
  zhangwei-report §6.1 揭示 prod 真实缺陷：腾讯 P5 面试 `finish: true` 触发评分时，
  `[scorer-prompt-loader] 找不到评分 prompt: tencent/star` 抛 STREAM_ERROR → 评分落库失败
  → 报告页空白（totalScore: null）。**腾讯 P5 完整体验被阻断**。

  跟进验证（本次修复中发现）两个独立但相关的缺陷：

  **Bug-029-A 评分 prompt 文件缺失**（已由 commit 272db21 部分修复）
  - `.knowledge/agents/scorer/{company}/{dimension}.md` 与 `lib/scoring/dimensions.ts#DIMENSION_WEIGHTS`
    **静态配置脱节** — 任何修改任一处都可能让另一处不一致
  - 历史快照：2026-07-19 zhangwei-report 时 tencent 仅 4 文件（缺 star.md）
  - 2026-07-20 commit 272db21（feat(e2e): Bug-021~028 修复）补全到 5 文件
  - **但是**：没有任何编译时校验保证未来不会再脱节

  **Bug-029-B PII 红线声明缺失**（本次发现）
  - 防御性测试扫 20 个 .md 文件，发现 **5 个缺少 PII 红线/35+ 友好声明**：
    - `ali/star.md`、`ali/sysdesign.md`
    - `tencent/star.md`
    - `bili/star.md`、`bili/sysdesign.md`
  - 风险：AI 评分这些维度时可能问出 PII 红线问题（婚否/年龄/房产）→ 违反《就业促进法》第 27 条
  - **面试陪练业务特殊性**：35+ 群体是核心用户，PII 红线是法律红线也是产品生命线

root_cause: |
  **设计层面缺失两个校验**：
  1. **静态一致性校验**：`DIMENSION_WEIGHTS` (TS 静态) 与 `.knowledge/agents/scorer/` (文件系统)
     之间没有 build-time/test-time 校验 — 任何修改都不会失败
  2. **内容完整性校验**：`.md` 文件只校验 front-matter schema（已有），未校验 body 必须包含
     "红线"或"35+"合规声明

  **历史教训回顾**：
  - Bug-013/014/015/016/017 反复修 EdgeOne 部署问题，但没人发现"配置 vs 文件系统"脱节
  - Sprint 1 Gap 收尾的 G3 SES 邮件模块用了"schemas + 防御性测试"模式，本次评分模块**没复制**

solution: |
  **防御性测试（核心修复）** — `tests/unit/dimension-weights-prompt-consistency.test.ts`：
  1. **DIMENSION_WEIGHTS 权重总和 = 1.0**（每家公司）— 防 typo
  2. **DIMENSION_WEIGHTS 中 weight > 0 的 (company, dimension) 必须有对应 .md 文件** —
     Bug-029-A 核心防御
  3. **front-matter.company 与目录名一致** — 防止放错目录
  4. **front-matter.dimension 在 8 维度白名单** — 防 dimension 字段 typo
  5. **weight 字段在 [0, 1]** — 防 weight 字段错
  6. **文件大小 ≤ 64KB** — 防超限
  7. **body 必须包含"红线"或"35+"** — Bug-029-B 核心防御
  8. **回归测试**：腾讯 P5 finish 触发评分时 5 维度 prompt 全员就绪
  9. **回归测试**：4 公司所有非零维度 .md 都存在（共 20 个）

  **内容补全**：
  - 5 个 .md 文件（ali/star, ali/sysdesign, tencent/star, bili/star, bili/sysdesign）
    末尾追加 `## 红线` 章节：禁止 PII（婚否/子女/房产/年龄/PII） + 35+ 友好声明

  **设计模式（供未来复用）**：
  - **schemas + 防御性测试**：任何"代码静态配置 + 文件系统资源"组合，
    都应写一致性测试。这次问题就是没复制 SES 模块的模式
  - **失败前置**：让 pnpm test 在 build time 失败，而不是等 prod 用户跑到 finish 才看到空白

verification:
  unit:
    - 防御性测试 9/9 passed（tests/unit/dimension-weights-prompt-consistency.test.ts）
    - 全套 vitest 164/164 passed（新增 9 个，无 regression）
    - 0 type errors
    - 0 lint errors（25 warnings 全是历史，与本次无关）
  e2e_pending:
    - 下次 E2E 跑腾讯 P5 finish 流程，验证评分完整入库不再 STREAM_ERROR
    - 跑四家公司 × 五维度全评分链路（20 个维度）— 已写在 test 文件中可重放
  pii_red_line:
    - 5 个文件已含"红线"章节（diff 可见）
    - 防御性测试 now enforced（fail-fast）

learned_from:
  - commit: 272db21 (feat(e2e): Bug-021~028 修复 + 上线准备) — 补 tencent/star.md
  - file: lib/scoring/dimensions.ts:88-93 (activeDimensions 逻辑)
  - file: lib/scoring/prompt-loader.ts:61-101 (loader)
  - file: app/api/interview/[id]/message/route.ts:181-197 (调用层)
  - file: .knowledge/bugs/2026-07-19-zhangwei-report.md (问题发现来源)

prevention:
  level_1_compile_time:
    - "代码静态配置 × 文件系统资源"模式必须写一致性测试
    - 防御性测试 = 单 Agent 写代码只能"加东西"，测试是"让系统从此变聪明"
  level_2_content_quality:
    - 任何用户面对 prompt 必须包含合规声明（PII 红线 + 35+ 友好）
    - 防御性测试强制执行 — 缺"红线"立即 fail
  level_3_process:
    - Sprint 1 Gap 收尾时，G3 SES 用了 schemas + 防御测试模式，本次评分模块**没复制**这个模式 → 教训已固化为"schemas + 防御测试"双轨制
  level_4_deploy:
    - 类似 Bug-013~017 的"配置与运行时脱节"问题，写一致性测试兜底
    - 把 zhangwei-report §6.1 列为 P0 修复参考案例

anti_pattern:
  - "我跑过就行" — 跑通 ≠ 正确，prod 触发评分时才暴露
  - "以后再改" — 不会有"以后"，防御性测试现在就该写
  - "加个 if 不就完了" — 这是熵增的源头；正确做法是加测试让错误立即可见
  - "复制已有模块就好" — SES 写了防御测试，本次评分**没复制** → Bug 复发

related:
  - bug-013/014/015/016/017 (EdgeOne 部署系列)
  - bug-008-phase14-p0-fixes (P0-2 评分滑动窗口)
  - bug-009-mock-scoring-not-dimension-aware (mock 评分差异化)
  - bug-024-false-positive (登录页误诊 — 同类"现象 ≠ 根因"教训)

notes: |
  zhangwei-report §6.1 结论是"补 4 个 tencent prompt 文件" — 但实际上 star.md 已在 commit 272db21 修复，
  真正的根因是"配置与文件系统无编译时校验"。本次修复采用"防御性测试 + 内容补全"双轨。

  Bug-030 (PII 红线缺失) 是测试驱动的意外发现 — 这正是"测试不是负担而是探照灯"的典型案例。
  下次任何 AI prompt 模块上线前，必须过防御性测试 + 内容质量校验。