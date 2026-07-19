---
id: bug-2026-07-20-024
title: 登录页 prod 暴露 dev 凭据 — 误诊，关闭
category: bug
severity: low
status: false-positive
tags: [e2e, prod-verify, false-positive, login, autofill]
created_at: 2026-07-20
project: interview-buddy

problem: |
  10-Agent 真实环境 E2E 跑完后，agent #1 (李明) 上报："/login 页面预填了 dev 凭据 20925250 / Hello2026"，
  怀疑 prod 安全风险。

investigation: |
  全局 grep "20925250" 和 "Hello2026" 在 app/、lib/ 下零命中，仅出现在：
  1. tests/unit/resume-list.test.ts:62（mock 测试数据，不进 prod）
  2. docs/PROD_VERIFY_2026-07-17.md（蕾姆 7/17 自己写的 prod SOP，标记 dev 凭据）
  3. .knowledge/bugs/2026-07-20-bug-020-prod-env-verification.md（蕾姆 7/20 E2E 步骤）
  4. .knowledge/bugs/2026-07-15-e2e-turnstile-key-leak.yaml（蕾姆 7/15 经验卡）

  app/login/page.tsx 源码确认：input 的 value 完全由 React state 控制（useState('')），无 defaultValue，
  无任何硬编码或 defaultValue 形式注入 dev 凭据。

root_cause: |
  真实原因两条之一（任一即可解释）：
  (a) 浏览器 autofill：蕾姆 7/15 + 7/17 + 7/20 三次 E2E 都用这个账号 curl/playwright 登录过，
      浏览器/Playwright persistent context 记住了 form 值。
  (b) Playwright agent 并发共享浏览器 storage，多个 E2E 用户态污染。

solution: |
  **关闭 Bug-024，不修改 login 页面。**

  教训：
  1. 蕾姆/agent 看到 "prod 页面预填 dev 凭据" 时，第一步是 grep 源码 + read 页面，而不是直接报警。
  2. dev 凭据应只在内部 SOP 文档里出现，**且页面应在登录后清空 localStorage / cookies / form state**，
     避免污染下个 agent。
  3. 后续 E2E 应使用**全新 incognito 上下文** + 测试专用账号（避免 20925250 这种"真邮箱 + 弱密码"）。

verification:
  grep_app: 0 hits in app/**/*.{tsx,ts}
  read_login_page: 0 hardcoded values, useState('') init only
  prod_url: /login 输入框为空，autocomplete=email / current-password 由浏览器决定

learned_from:
  - file: app/login/page.tsx
  - file: .knowledge/bugs/2026-07-20-bug-020-prod-env-verification.md

prevention:
  - 后续 E2E 测试前清浏览器 storage（context.clearCookies + clear localStorage）
  - dev 凭据 SOP 文档应明确标注 "此账号仅供本地测试，请勿截图/录屏分享"
  - Phase 14 后续可加：playwright 用 storageState=null 启动，杜绝跨 session 污染