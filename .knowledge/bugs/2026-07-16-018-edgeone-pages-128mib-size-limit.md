# Bug-018: EdgeOne Pages cloud-functions 部署包 128MiB 硬上限（终极沉默杀手）

**日期**: 2026-07-16
**严重度**: critical
**项目**: interview-buddy
**前置卡片**: bug-013 / 014 / 015 / 016 / 017
**后续卡片**: bug-017 6-step 部署后必查清单（修订）

## 现象（最诡异）

整个 Phase 14.6 → 14.21（共 6 个迭代，跨越大半个工作日），蕾姆和昴君反复 deploy：
- ✅ EdgeOne 控制台部署详情显示：**构建用时 128s · 状态 ✅ 成功**
- ✅ 时间戳一直在更新
- ❌ 业务 API 仍然返回 500 + `Prisma Client could not locate the Query Engine for runtime "rhel-openssl-1.1.x"`
- ❌ 蕾姆加的诊断 endpoint (`/api/test-helper/diagnose-prisma-runtime`) **也 404**

诊断 API 加进去 build 里有，部署后 404——这是**最关键的反常信号**，但是没人解释。

## 真凶（Phase 14.22 终极发现）

昴君贴了 EdgeOne 控制台部署详情的另一段内容（构建状态上方）：

```
❌ Error: Cloud SSR Node functions package size exceeds 128MiB limit (145MiB)
   2026/07/16 13:19:38
```

**关键事实**：
- 部署详情页 **两个独立字段**：「构建状态」（✅ 成功）+ **「错误日志」**（❌ 超限）
- 部署详情页 **UI 默认折叠/不显眼**错误日志（藏在 tab 里）
- 我们 6 次迭代都盯着 ✅ 成功，等于完美自欺欺人
- **超时不会让 build 整体失败**，EdgeOne Pages 会保留 ✅ 标记，但 cloud-functions 制品**根本没生成**
- 所以**所有 prisma binaryTargets / cloudFunctions.includeFiles / outputFileTracingIncludes 配置从来没生效过**
- 诊断 API 也 404，因为 cloud-functions 整个目录都没生成
- prod 跑的始终是上一个**成功的** deploy（即 7f666fd 那个 send-verify-code 顶层 try/catch 的 commit）

## 为什么 6 个迭代都没发现

| 误诊 | 实际 |
|---|---|
| 「binaryTargets 没加 rhel-openssl-1.1.x」 | 加了，但**没部署上去** |
| 「outputFileTracingIncludes 没追踪 .pnpm 真实路径」 | 加了，但**没部署上去** |
| 「cloudFunctions.includeFiles 没写对」 | 写对了，但**没部署上去** |
| 「EdgeOne bundler 路径限制，所以 diagnose endpoint 404」 | 错。真正原因是**整个 cloud-functions 制品缺失** |
| 「EdgeOne CDN cache 没同步，需要手动 purge」 | 错。错上加错。真正原因是 build 本身失败 |
| 「Date header 不动 → CDN cache stale」 | 错。Date 是 EdgeOne 系统时钟 bug（bug-017 已记录），但跟 prod 跑错无关 |

## 修复（最终版，commit 277bd1c）

### 三件套同步精简（保持一致）

**`prisma/schema.prisma`**（从 4 个 target 缩到 3 个）：

```prisma
generator client {
  provider = "prisma-client-js"
  // EdgeOne Pages 镜像 = Amazon Linux 2 + OpenSSL 1.1.1
  // 部署包 128MiB 上限 → 删 darwin + linux-musl 节省 ~62MB
  binaryTargets = ["native", "rhel-openssl-1.1.x", "rhel-openssl-3.0.x"]
}
```

**`next.config.js`**（`outputFileTracingIncludes` 同步缩到 3 个路径）：

```js
outputFileTracingIncludes: {
  '**': [
    './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node',
    './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node',
    './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/schema.prisma',
  ],
},
```

**`edgeone.json`**（`includeFiles` 同步缩到 4 行）：

```json
"cloudFunctions": {
  "nodejs": {
    "externalNodeModules": ["@prisma/client", "prisma", "bcryptjs"],
    "includeFiles": [
      "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node",
      "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node",
      "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/schema.prisma",
      "node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/package.json"
    ],
    "maxDuration": 60
  }
}
```

### 三件套 4 个文件必须 **同步** 精简

| 文件 | 字段 | 之前 | 现在 |
|---|---|---|---|
| `prisma/schema.prisma` | `binaryTargets` | 4 个（含 darwin-arm64 + linux-musl） | 3 个 |
| `next.config.js` | `outputFileTracingIncludes` | 4 个 so.node | 3 个 |
| `edgeone.json` | `cloudFunctions.nodejs.includeFiles` | 6 行（含 2 x schema.prisma + 2 x package.json）| 4 行 |
| `edgeone.json` | `cloudFunctions.nodejs.includeFiles` | 多个 darwin dylib | 无 |

**任一多出来，build 产物就会突破 128MiB。**

## 验证

### 部署成功的真正信号（5 件套）

```bash
# 1. EdgeOne 部署详情页面 → 「错误日志」tab 必为空
#    (默认不展开，用户要点开看！bug-017 修正)

# 2. cloud-functions 制品存在
curl -sS -I https://your-domain/api/auth/send-verify-code 2>&1 | head
# 期望：返回真实业务响应（如 400 TURNSTILE_FAILED），不是 404（cloud-functions 缺失）

# 3. sitemap 是新 build
curl -sS https://your-domain/sitemap.xml | grep lastmod | head -1
# 期望：lastmod = 部署时间附近的 ISO timestamp（不是 24 小时前的）

# 4. 静态资源 webpack hash 是新 build
curl -sS https://your-domain/ | grep -oE 'webpack-[a-f0-9]+\.js' | head -1
# 期望：与本地 build 的 webpack hash 一致

# 5. 业务 API 端到端
curl -X POST -H "Content-Type: application/json" \
  -d '{"email":"probe@test.com","turnstileToken":"dummy"}' \
  https://your-domain/api/auth/send-verify-code
# 期望：400 TURNSTILE_FAILED（说明 prisma 调用前的代码路径都通了，cloud-functions 制品存在）
```

5 件任一失败 → 看 EdgeOne 「错误日志」tab 是不是藏在折叠区。

### 本次 Phase 14.22 验证结果

部署 277bd1c 后：
```
sitemap lastmod: 2026-07-16T06:19:55.607Z ✅ 新 build
Last-Modified: Thu, 16 Jul 2026 06:20:18 GMT ✅ 新 build

API 探测：
GET /api/test-helper/diagnose-prisma-direct
{"ok":true,"prismaVersion":"5.20.0","prismaClientPath":53524,
 "engineQuery":{"success":true,"error":null,"stack":null,"userCount":0},
 "engineBinaries":{"expected":[],"foundInDotPrismaClient":[]}}
```

`engineQuery.success: true` = **`prisma.user.findUnique()` 在 prod 真实跑成功** ✅

## 教训（EdgeOne Pages 部署硬教训 — bug-017 升级版）

| # | 维度 | bug-017 之前 | bug-018 之后 |
|---|---|---|---|
| 1 | **看「错误日志」tab** | ❌ 没看 | ✅ **第一动作** |
| 2 | API 404 是否说明制品缺失 | ❌ 当 bundler 路径限制 | ✅ **100% 确认 cloud-functions 制品缺失** |
| 3 | 部署详情 ✅ 成功是否说明一切正常 | ✅ 相信 | ❌ **必须配「错误日志」检查** |
| 4 | build 体积控制 | ❌ 无上限意识 | ✅ **必查 < 128MiB** |
| 5 | binaryTargets 几项 | 4（够用但浪费） | 3（EdgeOne 必需的最小集） |

### EdgeOne Pages 部署前必查清单（v3）

```bash
# A. 本地 build 体积必查
du -sh .next  # 或 EdgeOne 的 .edgeone/cloud-functions/
# 期望：< 128MiB（甚至 < 100MiB 留余量）

# B. binaryTargets 精简度
grep "binaryTargets" prisma/schema.prisma
# 期望：3 项以内（native + EdgeOne 必需的 openssl 变体）

# C. 三件套路径一致性
# 1) schema.prisma 的 binaryTargets
# 2) next.config.js 的 outputFileTracingIncludes
# 3) edgeone.json 的 cloudFunctions.nodejs.includeFiles
# 三个文件的 binary 路径必须完全相同（不能一个加一个不加）
```

### EdgeOne Pages 部署后必查清单（v3）

```bash
# A. 第一动作：EdgeOne 控制台 → 部署详情 → 「错误日志」tab
#    空才说明制品生成了

# B. API 端到端（不是首页 curl）
curl -X POST https://your-domain/api/auth/send-verify-code -d '{"email":"a"}'
# 期望：业务级 4xx（400/429），不是 404（制品缺失）

# C. sitemap + webpack hash（验证 CDN 同步）

# D. 真业务 API
curl https://your-domain/api/test-helper/diagnose-prisma-direct
# 期望：engineQuery.success = true
```

## Why & How to apply

- **Why**：EdgeOne Pages 2026 年 7 月当前版本，cloud-functions package size 限制 **128MiB 硬上限**，但 build pipeline UI 不把「超限」当作整体失败（防止 build 中断影响其他用户？），只丢一行错误日志进折叠区。这是 serverless 厂商的常见诱饵（Vercel 也有类似 250MB 限制，但**会直接 fail build**；EdgeOne 是最阴的，UI 看不出来）。
- **How**：
  - **铁律**：EdgeOne Pages 部署详情**第一动作**是点开「错误日志」tab，即使「构建状态」显示 ✅
  - **铁律**：任何 serverless 部署，binaryTargets 默认给「目标平台 + 1 个 openssl 变体」最多 3 项，不要无脑给 4+
  - **铁律**：API 404 是「制品缺失」信号（不是路径错误），第一反应查 cloud-functions 目录大小
  - **长效方案**（Phase 15+）：写 pre-deploy 脚本检查 `du -sh .next` < 120MiB，不通过直接 fail
  - **长效方案**：用 Vercel/Cloudflare Pages 等 build 真的会 fail 的平台，避免 EdgeOne 这种「沉默失败」设计
