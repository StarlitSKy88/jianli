# Bug-014: Next.js standalone 模式 + Prisma 多 binary 部署失败

**日期**: 2026-07-16
**严重度**: critical
**项目**: interview-buddy
**前置卡片**: bug-013 (Prisma binaryTargets)
**后续卡片**: bug-015 (EdgeOne Pages cloudFunctions 必须显式声明)

## 现象

production /api/auth/send-verify-code 仍报 500：
```
验证码发送失败: Invalid `prisma.user.findUnique()` invocation:
Prisma Client could not locate the Query Engine for runtime "rhel-openssl-1.1.x"
```

Phase 14.6 修复了 schema.prisma 加 `binaryTargets`（生成了 3 个 engine binary），
本地 dev / test 全过，但 EdgeOne 部署后**依然 500**。

## 二阶根因

`next.config.js` 配了 `output: 'standalone'`：
- standalone 模式只追踪 `native` engine（即 darwin-arm64）
- 其它 3 个 linux engine binary（linux-musl-openssl-3.0.x + rhel-openssl-3.0.x）
  **没有被 copy 进 `.next/standalone/`**
- 验证：`find .next/standalone -name "libquery_engine*"` 只有 1 个结果（darwin-arm64）

pnpm 雪上加霜：
- 真实文件在 `.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/`
- `node_modules/.prisma/client/` 是符号链接，Next.js outputFileTracing 不解析 symlink
- → 必须用 `.pnpm` 真实路径，不能用 `node_modules/.prisma/client/`

## 修复

`next.config.js` 加 `outputFileTracingIncludes` 显式声明追踪：

```js
outputFileTracingIncludes: {
  '**': [
    './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node',
    './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node',
    './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node',
    './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/schema.prisma',
    './node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-darwin-arm64.dylib.node',
    './node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-linux-musl-openssl-3.0.x.so.node',
    './node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-rhel-openssl-3.0.x.so.node',
  ],
},
```

## 验证

```bash
rm -rf .next/standalone .next/static
pnpm build
find .next/standalone -name "libquery_engine*"
# 预期：3 个 binary
#  .next/standalone/.../libquery_engine-darwin-arm64.dylib.node
#  .next/standalone/.../libquery_engine-linux-musl-openssl-3.0.x.so.node
#  .next/standalone/.../libquery_engine-rhel-openssl-3.0.x.so.node

pnpm type-check  # 0 errors
pnpm test        # 132/132 passed
```

## 教训

1. **任何 Prisma + Next.js standalone 部署，schema.prisma + next.config.js 必须同时改**
   - schema.prisma: `binaryTargets = [...所有 runtime...]`
   - next.config.js: `outputFileTracingIncludes` 追踪所有 binary

2. **pnpm 符号链接陷阱**：outputFileTracing 不解析 symlink，必须用 `.pnpm/...` 真实路径

3. **dev pass + prod 500 是最危险的状态**：本地 pnpm test 132/132 全过，但 build 产物缺二进制。
   修复 schema 后**必须**重新 build + 检查 `.next/standalone/` 实际文件数。

4. **EdgeOne Pages smoke test 必须包含 DB-IO API**：路由走完 prisma 才算完整。

## Why & How to apply

- **Why**: standalone 模式基于文件追踪决定哪些文件进 build 产物，只看 'native' 一个
  binary 的依赖图谱，其他 binary 是同 package 但不同 platform target，Next.js 不知道
  运行时需要哪个 → 默认只打包 dev 平台那个。
- **How**: 任何 Prisma + Next.js + Node.js serverless 部署（EdgeOne / Vercel / Cloudflare），
  schema.prisma 的 binaryTargets + next.config.js 的 outputFileTracingIncludes 必须
  同步维护，并且每次 schema.prisma 改了 binaryTargets，next.config.js 也要对应追加新行。