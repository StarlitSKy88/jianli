# interview-buddy

> **面向 35+ 群体的 AI 面试陪练 Web 应用**

---

## 🎯 产品定位

35+ 求职群体的 AI 模拟面试陪练。每日 3 次免费，超出 ¥9.9/次。

支持 4 家公司（字节/阿里/腾讯/B站）× 4 类岗位 = **16 关**真实模拟。

---

## 🚀 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 准备环境变量
cp .env.local.example .env.local
# 编辑 .env.local，填写 DATABASE_URL / MINIMAX_API_KEY 等

# 3. 初始化数据库
pnpm prisma migrate dev
pnpm prisma db seed

# 4. 启动开发服务器
pnpm dev
# 访问 http://localhost:3000
```

---

## 📚 技术栈

| 层级 | 选型 |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind + Shadcn/ui |
| Backend | Next.js API Routes（全栈单体） |
| AI | minimax (minimax-M3) 主 / Claude / DeepSeek 备 |
| Database | PostgreSQL + Prisma 5.x |
| Cache | Redis |
| 部署 | Vercel / EdgeOne Pages |
| 知识库 | 文件系统 + YAML + git（复利工程） |

---

## 📁 项目结构

```
interview-buddy/
├── app/                  # Next.js 14 App Router
├── lib/                  # 业务逻辑
│   ├── ai/               # AI Provider 路由
│   ├── auth/             # 认证
│   ├── agents/           # 26 个 Agent
│   ├── compound/         # 复利工程子 Agent
│   └── ...
├── prisma/               # 数据库 schema
├── tests/                # 测试
├── scripts/              # 复利工程命令
├── .knowledge/           # ⭐ 复利知识库
├── docs/                 # PRD / 技术方案 / 任务清单
├── CLAUDE.md             # ⭐ 复利工程总纲
└── README.md
```

---

## 📜 文档索引

- [CLAUDE.md](./CLAUDE.md) — **项目根总纲（必读）**
- [docs/PRD.md](./docs/PRD.md) — 产品需求文档
- [docs/TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md) — 技术方案
- [docs/TASK_LIST.md](./docs/TASK_LIST.md) — 原子级任务清单（48 个任务）

---

## 🔄 复利工程

本项目使用 [Ever 公司开源的复利工程方法论](https://example.com)：

```
计划(Plan) → 执行(Execute) → 审查(Review) → 固化(Compound)
```

任何 PR 必须经过 **14 Agent 并行审查**，完成后自动触发 `./scripts/compound.sh` 写入知识库。

---

## 📜 许可

仅供内部使用。
