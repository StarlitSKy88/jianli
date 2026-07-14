---
id: pattern-2026-07-14-003
title: 腾讯云 EdgeOne Pages 部署适配（next.config.js + edgeone.json）
category: pattern
severity: medium
tags: [edgeone, deploy, nextjs, standalone, tencent-cloud, sse]
created_at: 2026-07-14
project: interview-buddy

problem: |
  35+ 用户群在国内，Vercel 海外节点 200-500ms 延迟 = 用户体验崩。
  需要国内 < 50ms 访问 + 免费 + Next.js 14 App Router + SSE 流式全支持。

  国内对标 Vercel 选项对比：
  - EdgeOne Pages（腾讯）：免费无限流量 + 国内 200 节点 + 原生 Next.js
  - Cloudflare Pages：免费无限但国内访问 100-200ms（境外 PoP）
  - 阿里云 ESA：3 个月试用，无永久免费

  选 EdgeOne 后，发现 3 个适配问题：
  1. App Router + SSE 流式 — 需在 headers 加 X-Accel-Buffering: no
  2. Prisma + bcrypt 必须 serverExternalPackages（不打包）
  3. 部署体积优化 — output: 'standalone' 减小 EdgeOne 函数包

solution: |
  **A. next.config.js EdgeOne 适配**

  ```js
  const nextConfig = {
    experimental: {
      typedRoutes: true,
      serverActions: {
        bodySizeLimit: '10mb',  // PDF 简历 5MB + 缓冲
      },
    },

    output: 'standalone',        // EdgeOne 函数体积 -60%
    poweredByHeader: false,      // 安全
    compress: true,
    productionBrowserSourceMaps: false,

    async headers() {
      return [{
        source: '/api/interview/:id/message',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
          { key: 'X-Accel-Buffering', value: 'no' },  // 关键：关 CDN 缓冲
          { key: 'Connection', value: 'keep-alive' },
        ],
      }];
    },

    serverExternalPackages: ['@prisma/client', 'bcryptjs'],  // 不要打包
  };
  ```

  **B. edgeone.json（项目根目录）**

  ```json
  {
    "build": {
      "command": "pnpm install --frozen-lockfile && pnpm prisma generate && pnpm build",
      "outputDir": ".next",
      "nodeVersion": "20.x",
      "buildRegion": "ap-hongkong"
    },
    "functions": {
      "memory": 256,        // 默认 128 → PDF 解析需要
      "maxDuration": 60     // 默认 30s → SSE 流需要
    },
    "headers": [
      {
        "source": "/api/interview/:id/message",
        "headers": [
          { "key": "Cache-Control", "value": "no-cache, no-transform" },
          { "key": "X-Accel-Buffering", "value": "no" },
          { "key": "Connection", "value": "keep-alive" }
        ]
      },
      {
        "source": "/(.*)",
        "headers": [
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
        ]
      }
    ]
  }
  ```

  **C. 数据库：腾讯云 PostgreSQL（必备）**

  - EdgeOne 是无服务器环境，SQLite 文件系统不可写（每次冷启动重置）
  - 必须用云数据库 PostgreSQL，DATABASE_URL 带 `?sslmode=require`
  - 本地先 `pnpm prisma migrate deploy` 到腾讯云 PG，部署时无需再 migrate

  **D. 验证流程**

  ```bash
  # 1. 本地 standalone 模拟 EdgeOne 运行时
  pnpm build
  PORT=3101 NODE_ENV=production \
    DATABASE_URL="..." JWT_SECRET="..." \
    node .next/standalone/server.js
  # 启动 < 200ms，curl 全路由 200，i18n envelope 中文

  # 2. EdgeOne 控制台构建命令必须含 prisma generate
  pnpm install --frozen-lockfile && pnpm prisma generate && pnpm build
  ```

  **E. 部署成本**

  | 项 | 试用 | 正式 |
  |---|---|---|
  | EdgeOne Pages | ¥0 | ¥0 |
  | 腾讯云 PG 1C1G | ¥0（1 个月） | ~¥50/月 |
  | 域名 | ¥0（edgeone.app） | ~¥60/年 |
  | **合计** | **¥0** | **~¥50/月** |

verification:
  build: pnpm build → 0 warnings / 0 errors / 17 routes
  standalone: node .next/standalone/server.js → 186ms 启动
  smoke: GET / /login /register /interview/new /admin/models → 全 200 @ 134ms
  i18n: API 错误 envelope 中文（UNAUTHENTICATED="未登录"）
  sse_headers: X-Accel-Buffering: no 已配置
  output_size: .next/standalone/ 总 ~20MB（无 node_modules 冗余）

learned_from:
  - task: Phase 8.3 → EdgeOne 适配
  - file: next.config.js (output: standalone + headers + serverExternalPackages)
  - file: edgeone.json (buildRegion + functions memory/maxDuration)
  - file: docs/EDGEONE_DEPLOY.md (完整部署指南)

---

**Why**：
- EdgeOne Pages 是国内「类 Vercel」最优解：免费 + 国内 200 节点 + 原生 Next.js 14
- `output: 'standalone'` 生成 `.next/standalone/server.js` 单文件入口，EdgeOne 直接 node 执行
- `serverExternalPackages` 让 Prisma + bcrypt 用 Node 原生 require，不被 webpack 打包（避免运行时找不到二进制）
- `X-Accel-Buffering: no` 关掉 CDN/反代缓冲，SSE 才能实时推流
- 必须显式 `pnpm prisma generate` 在构建命令，否则 EdgeOne 找不到 `@prisma/client`

**How to apply**：
- 任何 Next.js + 国内部署 → EdgeOne Pages（首选）/ Cloudflare Pages（备选）
- 任何 SSE 流式 → 必加 `X-Accel-Buffering: no` + 60s+ 超时 + 心跳
- 任何 Prisma 部署 → 构建命令加 `prisma generate`
- 任何「类 Vercel」部署 → 必读部署平台的 functions 内存 / 超时 / region 配置