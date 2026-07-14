# interview-buddy — 复利工程总纲

> **核心哲学**：修完 bug 就固化解法 — 让系统越用越聪明
> **本文件是项目的"大脑"，每次重大决策后必须更新**
> **最后更新**：2026-07-14 (Phase 8.3 完成)

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
| Phase 12 Turnstile 真实部署 | ✅ 完成（2026-07-15） | widget 0x4AAAAAAD168NRRcdDk1tma + 域名 localhost/jianli-p2nw5zbr.edgeone.cool/jianli.taomyst.top + curl 链路验证 + 部署脚本 |

### 当前质量基线

| 项 | 数值 |
|---|---|
| `pnpm type-check` | 0 errors |
| `pnpm build` | 0 warnings / 0 errors |
| `pnpm test` (vitest) | 108/108 passed |
| `pnpm test:e2e` (Playwright) | 17/17 passed + 1 skipped |
| 真实链路 | send→resend cooldown→register→login→/me 全 200 ✅ |
| 评分 prompt | 8 关键维度 × 4 公司 YAML + 6 兜底维度 = 14 文件 |
| `pnpm test:e2e` (Playwright) | 17/17 passed + 1 skipped |
| First Load JS（首页）| 87.4 kB |
| 静态页面 | 6 个 (`/` `/login` `/register` `/interview/new` `/admin/models` `/_not-found`) |
| 动态 API 路由 | 11 个 |
| 知识卡 | patterns 6 + bugs 10 + recipes 1 = 17 张 |

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
