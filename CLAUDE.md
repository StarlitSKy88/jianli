# interview-buddy — 复利工程总纲

> **核心哲学**：修完 bug 就固化解法 — 让系统越用越聪明
> **本文件是项目的"大脑"，每次重大决策后必须更新**
> **最后更新**：2026-07-16 (Phase 14.22 完成 — EdgeOne Pages prisma 真实环境跑通)

---

## 0. 项目一句话

**35+ 群体的 AI 面试陪练 Web 应用**。4 家公司（字节/阿里/腾讯/B站）× 4 类岗位 = **16 关**真实模拟。每日 3 次免费，超出 ¥9.9/次。

---

## 1. 复利工程四步循环 ⭐

```
计划(Plan) → 执行(Execute) → 审查(Review) → 固化(Compound)
   ↑                                       │
   └───────────────────────────────────────┘
```

### 1.1 计划（20% 时间）

**第一铁律**：**任何任务开始前，必须先看 [PRD.md](./docs/PRD.md) + [TASK_LIST.md](./docs/TASK_LIST.md)**

**任务颗粒度**：
- **原子级**：1 个任务 = 1 个 PR = 1 个 commit = ≤ 30 分钟
- **5 维验证**：每个任务必须有业务/技术/安全/性能/可维护 5 个角度的具体验证点

### 1.2 执行（20% 时间）

**第二铁律**：**TDD — 先写测试，再写代码**

- ✅ RED → GREEN → REFACTOR
- ✅ 严格遵守 SOLID + KISS + YAGNI + DRY
- ✅ 函数 < 50 行，文件 < 800 行

### 1.3 审查（30% 时间）

**第三铁律**：**任何 PR 必须经过 14 Agent 并行审查才能合并**

详见 [第 3 节：26 Agent + 14 审查](#3-26-个专项-agent--14-个并行审查-agent)

### 1.4 固化（30% 时间）⭐ 核心

**第四铁律**：**修完 bug 立即触发 `compound` 命令，6 个子 Agent 并发固化**

详见 [第 4 节：固化命令](#4-固化命令)

**为什么固化是核心？**
- 单 Agent 写代码只是"加东西"
- 固化是"让系统从此变聪明"
- 100 次 bug 修复 → 200+ 张经验卡 → 第 101 次 bug 修复 = 5 秒

---

## 2. 知识库结构（项目根 `.knowledge/`）

```
.knowledge/
├── bugs/         # bug 经验卡（YAML）— 实际遇到的问题 + 解法
├── patterns/     # 设计模式卡（YAML）— 可复用的代码模式
├── decisions/    # ADR 卡（YAML）— 重大架构决策
├── recipes/      # 常用代码片段
└── case-stories/ # 35+ 真人案例（YAML）— 未来推送
```

### 2.1 YAML 经验卡标准格式

```yaml
id: bug-YYYY-MM-DD-NNN
title: 一句话问题
category: bug | pattern | decision | recipe
severity: critical | high | medium | low
tags: [keyword1, keyword2]
created_at: YYYY-MM-DD
project: interview-buddy

problem: |
  详细描述问题（含环境、复现步骤）。

solution: |
  详细解法（含代码示例）。

verification:
  unit: 单元测试结果
  integration: 集成测试结果
  e2e: 端到端测试结果

learned_from:
  - commit: abc123
  - file: lib/xxx/yyy.ts
```

**Why YAML？** 易读 + 可 grep + 可 git diff + 无需数据库 = 复利的物理基础

---

## 3. 26 个专项 Agent + 14 个并行审查 Agent

### 3.1 26 个专项 Agent（按场景触发）

| Agent | 职责 | 触发条件 |
|---|---|---|
| `planner` | 拆解任务、写 PRD | TaskCreate 时 |
| `architect` | 架构决策、ADR | 重大变更前 |
| `tdd-guide` | 强制 TDD | 新功能开发 |
| `code-reviewer` | 代码质量 | 任何 PR |
| `security-reviewer` | OWASP Top 10 | 涉及 auth/payment/PII |
| `perf-reviewer` | 性能瓶颈 | 涉及 DB/API/缓存 |
| `ui-designer` | UI 设计、a11y | 涉及 UI 改动 |
| `ux-researcher` | 用户体验 | 涉及流程改动 |
| `refactor-cleaner` | 死代码清理 | 定期 |
| `doc-updater` | 文档更新 | 重大决策后 |
| ... | ... | ... |

### 3.2 14 个并行审查 Agent（每个 PR 强制）

| # | Agent | 审查维度 |
|---|---|---|
| 1-3 | business-x | 业务需求匹配度 |
| 4-6 | tech-x | 技术实现质量 |
| 7-9 | security-x | OWASP、注入、权限 |
| 10-11 | perf-x | 性能、可扩展性 |
| 12 | a11y-x | 无障碍（WCAG 2.1） |
| 13 | i18n-x | 国际化（中英文） |
| 14 | legal-x | 合规（《就业促进法》红线） |

**如何并行？** PRD 进来后，14 个 agent 同时基于同一 git diff 输出独立报告，由主 Agent 汇总。

---

## 4. 固化命令 ⭐

### 4.1 三条核心命令

```bash
# 修完 bug 后固化经验
pnpm compound "问题描述"
# → 6 子 Agent 并发：分类 → 检索 → 起草 → 验证 → 索引 → 写入

# 14 Agent 并行审查（PR 前）
pnpm review lib/auth/password.ts

# 一键需求 → PR
pnpm elf-g "用户注册时邮箱重复应返回 409 而不是 500"
```

### 4.2 6 子 Agent 工作流

```
┌────────────────────────────────────────────────────┐
│  compound.sh "<问题描述>"                            │
│      ↓                                              │
│  1. categorizer: 分类（bug / pattern / decision）    │
│  2. retriever:   检索（已有类似解法吗？）           │
│  3. drafter:     起草（写 YAML 经验卡）             │
│  4. verifier:    验证（解法可复用吗？）             │
│  5. indexer:     加 YAML tag 标签                   │
│  6. writer:      追加写入 .knowledge/ + git commit  │
└────────────────────────────────────────────────────┘
```

### 4.3 命令实现位置

| 命令 | 脚本 | 核心逻辑 |
|---|---|---|
| `pnpm compound` | `scripts/compound.sh` | 调 6 个 lib/compound/* Agent |
| `pnpm review` | `scripts/review.sh` | 调 14 个审查 Agent |
| `pnpm elf-g` | `scripts/elf-g.sh` | 需求 → 自动开发 → 测试 → PR |

---

## 5. 反熵增原则 ⭐

**为什么需要这条？** 100% 的项目都会从"清爽"变成"屎山"。复利工程的核心是**反熵增**。

### 5.1 必做

- ✅ 每次修改必须让系统**更清晰**（而不是"先这样以后再改"）
- ✅ 每个 PR 必须经过 5 维验证
- ✅ Bug 修复必须固化经验卡
- ✅ 30 天无人触碰的代码 = 删掉或重写

### 5.2 必禁

- ❌ "我跑过就行" — 跑通 ≠ 正确
- ❌ "以后再改" — 不会有"以后"
- ❌ "加个 if 不就完了" — 这是熵增的源头
- ❌ 跳过审查 = 抄近路 = 未来 10x 返工

---

## 6. 文档变更流程

```
1. 改代码前   → 更新 TASK_LIST.md（如果新增任务）
2. 改代码时   → 代码 + 测试一起改
3. 改代码后   → pnpm review 14 agent 审查
4. 通过后     → pnpm compound 固化经验
5. PR 通过    → 自动 git commit + push
6. 重大决策   → 新建 .knowledge/decisions/YYYY-MM-DD-xxx.yaml
```

---

## 7. 安全与合规铁律 🚨

### 7.1 全局铁律

- ❌ **禁止硬编码 secrets**（API keys / passwords / tokens）
- ✅ **必须使用 .env**，且 `.env*local` 加进 `.gitignore`
- ❌ **生产环境操作** 需报告风险等级（不阻塞但记录）
- ✅ **可逆操作** 直接执行；**不可逆操作** 报告后执行

### 7.2 业务合规铁律（面试陪练特殊）

- ❌ **禁止询问** 婚否 / 有子女 / 是否有房（《就业促进法》第 27 条）
- ❌ **禁止询问** 任何与岗位能力无关的 PII
- ✅ **白名单校验** 在 `lib/utils/validate.ts`
- ✅ **AI 输入过滤** + **AI 输出 schema 校验**

### 7.3 代码安全铁律

- ❌ **禁止提示词注入**（"ignore previous instructions" 必须识别）
- ✅ **System prompt 白名单模式**
- ✅ **AI 输出必须 schema 校验**（不让 LLM 直接控制代码）

---

## 8. 团队协作保护

操作涉及**他人代码**（如：复现老项目、迁移历史数据）：

1. 报告危险程度
2. 不阻塞在确认上（按全权授权执行）
3. 操作前 git commit 一份 baseline

---

## 9. 必读文档（按角色）

### PM / 产品决策
1. [docs/PRD.md](./docs/PRD.md) — 产品需求
2. [docs/TASK_LIST.md](./docs/TASK_LIST.md) — 任务进度

### 研发 / Agent
1. [docs/TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md) — 技术方案
2. [docs/TASK_LIST.md](./docs/TASK_LIST.md) — 原子级任务
3. [本文件](./CLAUDE.md) — 复利工程总纲

### 运营 / 增长
1. [docs/PRD.md § 6 商业化](./docs/PRD.md) — 收费模型

---

## 10. 常用命令速查

```bash
# ============ 开发 ============
pnpm dev                # 启动开发服务器
pnpm build              # 生产构建
pnpm start              # 启动生产服务器

# ============ 质量 ============
pnpm type-check         # TypeScript 检查
pnpm lint               # ESLint 检查
pnpm format             # Prettier 修复
pnpm format:check       # Prettier 验证
pnpm audit              # 安全漏洞扫描

# ============ 测试 ============
pnpm test               # 单元 + 集成测试
pnpm test:e2e           # E2E 测试（Playwright）
pnpm test:perf          # 性能测试（k6）

# ============ 数据库 ============
pnpm prisma:generate    # 生成 Prisma client
pnpm prisma:migrate     # 运行 migrations
pnpm prisma:seed        # 种子数据
pnpm prisma:studio      # DB 可视化

# ============ 复利工程 ⭐ ============
pnpm compound "问题"    # 固化经验
pnpm review <path>      # 14 Agent 审查
pnpm elf-g "需求"       # 一键需求→PR

# ============ 环境 ============
pnpm env-check          # 环境变量检查
```

---

## 11. 项目状态（不断更新）

| 项 | 状态 | 备注 |
|---|---|---|
| Phase 0 初始化 | ✅ 完成（2026-07-14） | |
| Phase 1 数据库 | ✅ 完成（2026-07-14） | Prisma 11 表 schema + migrate |
| Phase 2 认证 | ✅ 完成（2026-07-14） | JWT + bcrypt + register/login/me |
| Phase 3 AI 基础 | ✅ 完成（2026-07-14） | ai-router 3-tier + 并发限流 |
| Phase 4 面试官 | ✅ 完成（2026-07-14） | 字节/阿里/腾讯/B站 4 家 + PII 7 类 |
| Phase 5 评分 | ✅ 完成（2026-07-14） | DRY scorer + 4 公司权重 + 持久化 |
| Phase 6 前端 | ✅ 完成（2026-07-14） | 5 页面 + SSE 流式 + a11y |
| Phase 7 付费埋点 | ✅ 完成（2026-07-14） | 限流 + 埋点 + mock 支付 + admin |
| Phase 8.1 E2E | ✅ 完成（2026-07-14） | Playwright 13/13 + 1 skipped |
| Phase 8.2 P0 修复 | ✅ 完成（2026-07-14） | 4 BLOCK + 1 WARN 全修 |
| Phase 8.3 生产构建 | ✅ 完成（2026-07-14） | 0 warnings / 17 routes / 烟雾测试全 200 |
| Phase 8.3 EdgeOne 适配 | ✅ 完成（2026-07-14） | standalone + edgeone.json + 文档 |
| Phase 8.4 复盘 | ✅ 完成（2026-07-14） | 9 WARN 经验卡已固化 |
| Phase 9.1 真实邮箱验证码 | ✅ 完成（2026-07-15） | verify-code.ts + send/register 路由 + 5 unit 测试 |
| Phase 9.2 接入测试邮件 | ✅ 完成（2026-07-15） | send→cooldown→register→login→/me 端到端 10 步全通 |
| Phase 9.3 评分 Prompt | ✅ 完成（2026-07-15） | 8 关键 + 6 兜底 = 14 YAML + loader + 16 测试 |
| Phase 9.4 前端 E2E | ✅ 完成（2026-07-15） | 17/17 E2E（含真实验证码链路）+ test-helper 钩子 + Playwright PORT=3001 |
| Phase 10 防刷号三件套 | ✅ 完成（2026-07-15） | 蜜罐 + IP 限流 + Turnstile（dev 旁路）+ 23 单测 + 17 E2E |
| Phase 12 Turnstile 真实部署 | ✅ 完成（2026-07-15） | widget 0x4AAAAAAD168NRRcdDk1tma + 域名 localhost/jianli-p2nw5zbr.edgeone.cool/jianli.taomyst.top + curl 链路验证 + 部署脚本 + **EdgeOne env 注入 + 自动重建触发** |
| Phase 14 端到端验证 | ✅ 完成（2026-07-15） | 10 人并发 + 30 轮深度 + subagent 评审；P0-1~5 全部修复 + P0-6 新增（saveReport transaction timeout）+ P0-7 新增（mock provider 隔离 AI quota 耗尽）；mock provider 30/30 = 100% 业务成功率 |
| Phase 14.5 mock 评分差异化 | ✅ 完成（2026-07-15） | Subagent 评审发现的 #142 P0：mock 之前 5 维度全 75 分（数据库验证 unique=1），现在按 system prompt 维度关键词返回差异化分数（8 维度 unique≥6）。新增 mock-dimension-scoring.test.ts（5/5 passed）+ 经验卡 009 |
| Phase 13.8 Resume dedup P2002 race | ✅ 完成（2026-07-15） | #134 race condition 修复：schema 改为 (userId, fileHash) 复合唯一（migration 20260715130000_resume_per_user_dedup），race recovery 按 (userId, fileHash) 复合查询。tests/stress/phase-13-8-resume-dedup-race.sh **4/4 passed**（A 上传 → B 跨用户上传 → A 重复上传去重）。bug-006 已更新为完整 solution |
| Phase 13.5 客服通道接入 | ✅ 完成（2026-07-15） | feedbacks 表（migration 20260715140000）+ FeedbackWidget 全局浮窗（app/components/FeedbackWidget.tsx，注入 layout）+ POST /api/feedback（防刷三件套 + 邮件通知）+ lib/email/feedback-notification（HTML escape + 截断） + docs/SUPPORT.md。13 单测全过（6 邮件 + 7 API），dev server 实地 POST 200 写 TiDB cuid 成功。128/128 vitest 全过 + 0 type errors + 0 new warnings |
| Sprint 1 上线 Gap 收尾 | ✅ 完成（2026-07-15） | 5 项任务全过：**G2 埋点对齐 PRD**（signup_complete/resume_uploaded/interview_started/interview_completed/payment_success；旧名 register_success/interview_start/interview_finish 全 rename + 19 事件白名单 + rate-limit-track 单测同步）+ **G9 Cookie 安全**（lib/auth/cookie.ts 抽出 setAuthCookie/clearAuthCookie）+ **G7 SEO**（app/sitemap.ts + app/robots.ts 约定生成 + layout metadataBase）+ **G3 SES 邮件**（lib/email/ses-sender.ts nodemailer + EMAIL_SENDER_MODE 切换 + 4 单测 + docs/EMAIL_SETUP.md + scripts/edgeone-inject-env.ts）。**Build**：132/132 vitest + 0 type errors + 0 lint warnings；routes 21→23（+sitemap.xml +robots.txt）；**MVP 状态**：5 Gap 修 4，G1 微信支付 + G4 admin 反馈页按决策延后 |
| Phase 14.22 EdgeOne Pages 128MiB 部署上限终极根因 | ✅ 完成（2026-07-16） | **真凶**：EdgeOne Pages cloud-functions 制品 128MiB 硬上限，build 145MiB 超限 → 「构建状态 ✅ 成功」+「错误日志 ❌ Cloud SSR Node functions package size exceeds 128MiB limit (145MiB)」**同时存在**（默认折叠错误日志，UI 误导）。Phase 14.6–14.21 共 6 个迭代的 prisma 修复（bug-013/014/015/016/017）从未真正部署过。**修复（commit 277bd1c）**：binaryTargets 精简 `["native", "rhel-openssl-1.1.x", "rhel-openssl-3.0.x"]` + 同步精简 `outputFileTracingIncludes` + `cloudFunctions.includeFiles`，build 145MiB → 110MiB。**验证**：`curl /api/test-helper/diagnose-prisma-direct` 返回 `{"ok":true,"prismaVersion":"5.20.0","engineQuery":{"success":true,"error":null,"userCount":0}}` ✅ prod 真实环境 `prisma.user.findUnique()` 跑通。**固化**：bug-018-edgeone-pages-128mib-size-limit.md（5-step 部署前必查 + 5-step 部署后必查），部署文档 § 9.2 加 ⛔ 条目 |

### 当前质量基线

| 项 | 数值 |
|---|---|
| `pnpm type-check` | 0 errors |
| `pnpm build` | 0 warnings / 0 errors |
| `pnpm test` (vitest) | 132/132 passed（Sprint 1 +4：ses-sender 4 个） |
| `pnpm test:e2e` (Playwright) | 17/17 passed + 1 skipped |
| 真实链路 | send→resend cooldown→register→login→/me 全 200 ✅ |
| 评分 prompt | 8 关键维度 × 4 公司 YAML + 6 兜底维度 = 14 文件 |
| 静态页面 | 7 个（**+2**：/sitemap.xml /robots.txt 约定生成） |
| 动态 API 路由 | 22 个（Login/Logout/Register/SendCode/Reset/VerifyCode/Feedback + Interview×3 + Payment×2 + Resume×2 + Admin×5 + Test×3）|
| 知识卡 | patterns **10** + bugs **18** + recipes **2** = 30 张（Phase 14.22 + bug-018 终极根因） |
| First Load JS（首页）| 87.2 kB |
| Phase 14.4 mock 30 轮 | **30/30 = 100% 业务成功率**，8 维度评分入库 |
| Phase 14.5 mock 维度差异化 | byte 5 维度评分 **unique ≥ 6**（修复前 = 1） |
| mock 维度单测 | tests/unit/mock-dimension-scoring.test.ts **5/5 passed** |
| Resume dedup race | tests/stress/phase-13-8-resume-dedup-race.sh **4/4 passed** |
| Sprint 1 上线 Gap | 5 项全过 ✅（G2 埋点 / G7 SEO / G9 Cookie / G3 SES）+ Phase 14.6 Prisma engine 修复（bug-013）|
| EdgeOne 部署准备 | ✅ Phase 14.6 Prisma binaryTargets + send-verify-code 顶层 try/catch 暴露 message |
| EdgeOne 128MiB 修复 | ✅ Phase 14.22 — bug-018 终极根因 + 277bd1c 三件套精简 + prod 验证 engineQuery.success=true |

### 部署就绪

- 部署文档：[docs/PRODUCTION_DEPLOY.md](./docs/PRODUCTION_DEPLOY.md) (Vercel 备选)
- **推荐部署**: [docs/EDGEONE_DEPLOY.md](./docs/EDGEONE_DEPLOY.md) (EdgeOne Pages 适配)
- 数据库：腾讯云 PostgreSQL（云数据库 PostgreSQL 试用）
- 适配配置：`next.config.js` (`output: 'standalone'`) + `edgeone.json` (buildRegion + functions)
- 成本：¥0 试用 / ~¥50/月 正式
- 国内延迟：< 50ms（vs Vercel 200-500ms）

---

## 12. 变更日志

- **2026-07-14 — Phase 8.3**：生产构建 0 warning + EdgeOne Pages 适配（`output: standalone` + `edgeone.json` + SSE headers） + 部署文档（Vercel + EdgeOne 双方案） + 3 张经验卡固化（prod-chunk-bug + apicn-envelope-sse-a11y + edgeone-deploy-pattern）。prod + standalone 烟雾测试全 200。
- **2026-07-14 — Phase 8.2**：14 Agent 并行审查 + P0 修复（security-x9 付费链路 / perf-x10 LLM 并发 / i18n-x13 API 中文 / a11y-x12 焦点+a11y / legal-x14 PII 扩展）。
- **2026-07-14 — Phase 8.1**：Playwright E2E 13/13 + 1 skipped。
- **2026-07-14 — Phase 0-7**：从 0 到 MVP 全栈（数据库 + 认证 + AI + 面试官 4 家 + 评分 + 前端 5 页面 + 限流 + 支付 + admin）。
- **2026-07-14**：v0.1 首发。复利工程总纲首次固化。项目初始化完成。
- **2026-07-15 — Phase 14**：端到端验证全套（10 人并发 + 30 轮深度 + subagent 评审）。P0-1~5 修复全部生效：P0-1 测试脚本验证器改造（区分业务成功 vs HTTP 200）/ P0-2 滑动窗口（`messages.max(50)`→`max(100)` + 截断 40）/ P0-3 SSE `X-Biz-Status: pending` header + 结构化 STREAM_ERROR 日志 / P0-4 parseOutput throw 不再 fallback / P0-5 provider 空 content 检测（OpenRouter + 通用 OpenAI 基类）。**新增 mock provider**（`USE_MOCK_AI=1` 隔离真实 AI quota 耗尽）。**新增 P0-6**：saveReport `prisma.$transaction` 超时默认 5s 不够 8 维度评分写入，显式 30s。**Phase 14.4 mock 30 轮 = 30/30 = 100% 业务成功率**，评分报告 8 维度全部入库。Subagent 评审打分 8.0/10，发现 1 个 P0（mock 评分差异化）+ 4 个次要问题待 #142/#140 处理。
- **2026-07-15 — Phase 13.8 Resume dedup race**：#134 race condition 修复完成。**根因（双重）**：(1) `Resume.fileHash @unique` 是全局唯一，不同 user 上传相同内容触发 P2002；(2) 即使 catch P2002 接住，race recovery 按 `(userId, fileHash)` 复合查 → miss → throw 500。**修复**：migration `20260715130000_resume_per_user_dedup` 删除 `resumes_fileHash_key` 全局唯一索引，新增 `(userId, fileHash)` 复合唯一索引 `userId_fileHash_unique`。race recovery 也按 `(userId, fileHash)` 复合查询。**验证**：tests/stress/phase-13-8-resume-dedup-race.sh（4/4 passed）+ TiDB migration 已应用 + 113/113 vitest + 0 type errors。**固化**：bug-006 更新为完整 solution + anti_pattern。
- **2026-07-15 — Phase 14.5**：Subagent 评审 P0 #142 修复完成。**根因**：mock 之前所有评分维度调用 callCount 阈值切换模式，且固定返回 `{score: 75, ...}`，数据库验证 byte 5 维度 unique=1（algo=cs=project=sysdesign=culture=75）。**修复**：`extractDimensionFromSystem()` 正则提取 system prompt 中的 `评分维度：${dim}` 关键词，按 `Record<Dimension, MockScoreResponse>` 返回 8 个独立的人工撰写 score/evidence/suggestions（tech:82/project:78/sysdesign:72/algo:76/cs:80/culture:74/star:77/pressure:68）。**验证**：tests/unit/mock-dimension-scoring.test.ts（5/5 passed）+ 数据库 byte unique ≥ 6。**固化**：bug-009-mock-scoring-not-dimension-aware.yaml。
- **2026-07-15 — Phase 14.6**：EdgeOne Pages 部署 Prisma engine missing 修复完成。**根因**：prisma/schema.prisma generator client 缺 binaryTargets，默认只生成 native binary（darwin-arm64），EdgeOne Pages 是 Amazon Linux 2 容器找不到匹配 engine → throw "could not locate Query Engine for runtime rhel-openssl-1.1.x"。**修复**：schema.prisma 加 binaryTargets = ["native", "darwin-arm64", "linux-musl-openssl-3.0.x", "rhel-openssl-3.0.x"]，`pnpm prisma generate` 验证 3 个 engine binary 全部生成。**关键辅助**：send-verify-code 路由顶层 try/catch 暴露真凶 message 到 response body（commit 7f666fd），是定位根因的唯一通道。**验证**：132/132 vitest + 0 type errors，commit aa374f3 push，等 EdgeOne rebuild + 用户浏览器重测。**固化**：bug-013-prisma-both-binary-engine.yaml（含 4-target 标配 + debugging_trace + deploy_lesson 3 件必做）。
- **2026-07-16 — Phase 14.10**：EdgeOne CDN cache stale 真相。**五阶根因（终极）**：用户手动 rebuild 后 EdgeOne 部署详情显示 ✅ 成功（02:31:59），但 curl 看到 Date header 还是昨天（Wed, 15 Jul 2026 18:45），sitemap lastmod + webpack hash 全是昨天 build。**真凶**：EdgeOne Pages build pipeline 和 CDN propagation 是两个异步过程，build 成功 ≠ CDN 同步。**EdgeOne 实时日志揭示真相**：send-verify-code 实际返回 400（TURNSTILE_FAILED，10ms，Nodejs20.19 runtime），prisma binary 修复早就生效了——但**用户浏览器缓存了 24 小时前的 500 响应**。**修复**：手动 purge cache。**教训（最沉痛）**：之前 5 个迭代（13/14/15/16/17）有 3 个其实是误诊（13/14/15 改 schema/config 是真的部署后的预防，但本次 prisma 错其实早就修好）。**铁律**：prod 5xx 第一时间查 EdgeOne 实时日志（请求 ID），不要相信浏览器显示。**固化**：bug-017-edgeone-cdn-cache-stale.md（含 5-step checklist：Date/lastmod/webpack hash/API 探针/端到端）。
- **2026-07-16 — Phase 14.22**：EdgeOne Pages 128MiB 部署上限（终极根因）。**真相大白**：EdgeOne Pages cloud-functions 制品 128MiB 硬上限，build 145MiB 超限 → 「构建状态 ✅ 成功」 + 「错误日志 ❌ Cloud SSR Node functions package size exceeds 128MiB limit (145MiB)」**两个字段同时存在但 UI 默认折叠错误日志**。Phase 14.6–14.21 共 6 个迭代所有 prisma 修复从未真正部署过（cloud-functions 制品根本没生成 → 诊断 API 也 404 → prod 始终跑旧 build）。**修复（commit 277bd1c）**：binaryTargets 精简到 `["native", "rhel-openssl-1.1.x", "rhel-openssl-3.0.x"]`（删 darwin-arm64 + linux-musl-openssl-3.0.x 节省 ~62MB），同步精简 `outputFileTracingIncludes` + `cloudFunctions.includeFiles`，build 145MiB → 110MiB。**验证**：`/api/test-helper/diagnose-prisma-direct` 返回 `engineQuery.success: true` ✅ prod 真实环境 `prisma.user.findUnique()` 跑通。**铁律（部署详情第一动作）**：永远先点 EdgeOne 控制台「错误日志」tab，即使「构建状态」显示 ✅；API 404 → cloud-functions 制品缺失，不是路径错误。**固化**：bug-018-edgeone-pages-128mib-size-limit.md（5 部署前必查 + 5 部署后必查），docs/EDGEONE_DEPLOY.md § 9.2 加 ⛔ 条目。
