# Bug-015: EdgeOne Pages cloudFunctions 必须显式声明 externalNodeModules

**日期**: 2026-07-16
**严重度**: critical
**项目**: interview-buddy
**前置卡片**: bug-013 (Prisma binaryTargets) + bug-014 (standalone outputFileTracingIncludes)

## 现象

bug-014 修复后 production 仍报 500：
```
验证码发送失败: Invalid `prisma.user.findUnique()` invocation:
Prisma Client could not locate the Query Engine for runtime "rhel-openssl-1.1.x"
```

本地 build 验证：`.next/standalone/` 含 3 个 engine binary → 看起来应该 OK。
EdgeOne 部署后**依然 500**。

## 三阶根因（终极版）

EdgeOne Pages 用**自己的**部署机制，不是 Next.js 的 `.next/standalone`：

1. **Next.js `output: 'standalone'` 生成 `.next/standalone/`** — 这只是 Next.js 自己的格式
2. **EdgeOne Pages build 阶段有自己的 bundler**：
   - 走 `.edgeone/cloud-functions/ssr-node/` 目录
   - 不会读 `.next/standalone/`
   - 默认行为：**webpack 打包所有依赖**
3. **@prisma/client 含 native module (.node binary)** — webpack 不懂怎么处理 native 文件
4. **结果**：
   - @prisma/client 被错误打包
   - libquery_engine-*.node binary 丢失
   - runtime 找不到 binary → throw 500

## 修复（EdgeOne Pages 官方推荐配置）

参考 [EdgeOne Pages edgeone.json 文档](https://pages.edgeone.ai/document/edgeone-json)：

```json
{
  "cloudFunctions": {
    "mainlandRegions": ["ap-guangzhou"],
    "overseasRegions": ["ap-hongkong"],
    "nodejs": {
      "externalNodeModules": [
        "@prisma/client",
        "prisma",
        "bcryptjs"
      ],
      "includeFiles": [
        "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node",
        "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node",
        "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node",
        "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/schema.prisma",
        "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/package.json",
        "node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-darwin-arm64.dylib.node",
        "node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-linux-musl-openssl-3.0.x.so.node",
        "node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-rhel-openssl-3.0.x.so.node"
      ],
      "maxDuration": 60
    }
  }
}
```

### 两个关键字段

**`externalNodeModules`**：
> If your Node.js function has dependencies that contain native modules or
> static files, configure externalNodeModules. This enables the builder to
> correctly separate these dependencies and copy them to the build artifacts.

EdgeOne bundler 会把 `@prisma/client` 拆出来不打包，让它直接走 `node_modules`。

**`includeFiles`**：
> If your Node.js function needs to directly read files, configure the
> includeFiles list. The builder copies these files to the build artifacts.

EdgeOne bundler 会把这些 binary 文件复制到 build artifacts。

### 为什么必须 includeFiles 列所有 binary？

prisma client 启动时根据 runtime 探测加载对应 binary。EdgeOne bundler 不会自动探测依赖包里的 binary，必须显式声明。

## 教训（Prisma + EdgeOne Pages 部署三件套）

| # | 文件 | 关键配置 |
|---|---|---|
| 1 | `prisma/schema.prisma` | `binaryTargets = ["native", "darwin-arm64", "linux-musl-openssl-3.0.x", "rhel-openssl-3.0.x"]` |
| 2 | `next.config.js` | `outputFileTracingIncludes` 追踪所有 binary（虽然 EdgeOne 不用 standalone，但本地 build 验证仍然需要） |
| 3 | `edgeone.json` | `cloudFunctions.nodejs.externalNodeModules + includeFiles` 显式声明 |

**任一缺失都会导致 production 500**。

## Why & How to apply

- **Why**：serverless 平台（Vercel / Cloudflare / EdgeOne）每个都有自己独特的 bundler，
  对 native module 的处理方式都不同。Prisma 这种 binary-on-disk 的依赖需要
  显式声明才能正确打包。文档散落在各平台，本地 dev 完全测不出来。
- **How**：
  - 任何 Next.js + Prisma + EdgeOne Pages 部署，三件套缺一不可
  - 部署前必查：edgeone.json 的 cloudFunctions.nodejs 字段
  - 部署后必测：所有 DB-IO API 路由（不只是首页）
  - 收到 500 必看：response body 是否有真凶 message（不是空 body）
    - 顶层 try/catch 暴露 message 是定位 root cause 的唯一通道