# 腾讯云 EdgeOne Pages 部署指南

> **Status**: ✅ Phase 8.3 → EdgeOne 适配完成（2026-07-14）
> **Build**: `pnpm build` → 0 warnings / 0 errors / 17 routes / 87.2 kB First Load JS / `output: 'standalone'`
> **数据库**: 腾讯云 PostgreSQL（云数据库 PostgreSQL）
> **目标**: 国内 < 50ms 访问 + 永久持久化 + ¥0 起步

---

## 1. 为什么选 EdgeOne Pages？

| 维度 | Vercel Hobby | EdgeOne Pages | Cloudflare Pages |
|---|---|---|---|
| **国内延迟** | 200-500ms | **< 50ms** ⭐ | 100-200ms |
| **永久免费** | ✅ 100GB 流量 | ✅ 无限流量 | ✅ 无限流量 |
| **Next.js 14 App Router** | ✅ 原生 | ✅ 原生 | ✅ 原生 |
| **SSE 流式** | ✅ | ✅ 30s | ⚠️ 10ms CPU |
| **构建分钟/月** | 6000 | 100 | 500 |
| **Functions 请求/月** | 1M | 1M | 3M |
| **合规（数据出境）** | ❌ 出境 | ✅ 全国内 | ❌ 出境 |
| **域名 / HTTPS** | ✅ 自动 | ✅ 自动 | ✅ 自动 |

**结论**：国内 35+ 用户群，**EdgeOne Pages 是最优解**。

---

## 2. 准备工作（一次性）

### 2.1 腾讯云账号 + EdgeOne 开通

1. https://console.cloud.tencent.com/ 注册 + 实名
2. https://console.cloud.tencent.com/edgeone 开通 EdgeOne（**当前免费**）
3. 完成「域名接入」（可暂时用 EdgeOne 提供的免费域名）

### 2.2 创建 PostgreSQL 数据库（关键）

1. https://console.cloud.tencent.com/postgres 进入 **云数据库 PostgreSQL**
2. 选择「**试用**」（1 核 1GB / 1 个月免费 — 够 MVP 验证）
3. 配置：
   - 实例规格：1 核 1GB（最低）
   - 网络：与 EdgeOne 同 VPC（**关键**：否则公网走流量）
   - 数据库版本：PostgreSQL 14+
   - 管理员：自定义账号（如 `interview` / 强密码）
4. 创建数据库 `interview_buddy`
5. **白名单**：暂时放 `0.0.0.0/0`（EdgeOne 节点动态 IP），后续接入 VPC 后改内网白名单
6. 拿到**外网连接串**：
   ```
   postgresql://interview:密码@xxx.tencentcloud.com:5432/interview_buddy
   ```
7. **必须开启 SSL**（EdgeOne 推荐）

### 2.3 代码托管

- GitHub（推荐）/ GitLab / Gitee 均可
- EdgeOne 原生支持 GitHub OAuth 接入

---

## 3. EdgeOne Pages 项目创建

### 3.1 控制台入口

1. https://console.cloud.tencent.com/edgeone/pages
2. 「**创建项目**」
3. 选 Git 仓库（授权 GitHub）
4. 选 `interview-buddy` repo

### 3.2 构建配置（关键）

| 配置项 | 值 | 说明 |
|---|---|---|
| **项目名称** | `interview-buddy` |  |
| **框架预设** | `Next.js` | 自动识别 |
| **构建命令** | `pnpm install --frozen-lockfile && pnpm prisma generate && pnpm build` | ⚠️ 加 prisma generate |
| **构建输出目录** | `.next` | 默认 |
| **Node 版本** | `20.x` | 强制 |
| **构建区域** | `香港`（推荐）或 `上海` | 离国内用户近 |
| **环境变量** | 见 §4 | 在控制台添加 |

### 3.3 高级配置（可选）

```yaml
# edgeone.json（放项目根目录，可选）
{
  "build": {
    "command": "pnpm install --frozen-lockfile && pnpm prisma generate && pnpm build",
    "outputDir": ".next",
    "nodeVersion": "20.x"
  },
  "functions": {
    "memory": 256,        # 默认 128 → 提升到 256 应付 PDF 解析
    "maxDuration": 60     # 默认 30s → 提升到 60s 应付 SSE 流
  },
  "headers": [
    {
      "source": "/api/interview/:id/message",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-transform" },
        { "key": "X-Accel-Buffering", "value": "no" }
      ]
    }
  ]
}
```

---

## 4. 环境变量（EdgeOne 控制台添加）

### 🔴 必须

| 变量 | 说明 | 示例 |
|---|---|---|
| `DATABASE_URL` | 腾讯云 PG 连接串（**带 SSL**） | `postgresql://interview:密码@xxx.tencentcloud.com:5432/interview_buddy?sslmode=require` |
| `JWT_SECRET` | ≥ 32 字符随机 | `openssl rand -hex 32` |
| `NODE_ENV` | 必须 `production` | `production` |

### 🟡 推荐

| 变量 | 说明 |
|---|---|
| `MINIMAX_API_KEY` | 主 AI Provider |
| `ANTHROPIC_API_KEY` | 备用 AI |
| `DEEPSEEK_API_KEY` | 备用 AI |
| `MINIMAX_BASE_URL` | `https://api.MiniMax.chat/v1` |
| `MINIMAX_MODEL` | `MiniMax-M3` |
| `LLM_MAX_CONCURRENT` | `8` |
| `NEXT_PUBLIC_APP_URL` | `https://your-edgeone-domain.edgeone.app` |
| `FREE_DAILY_QUOTA` | `3` |
| `PAID_PRICE_CNY` | `990` |

### 🟢 可选

| 变量 | 用途 |
|---|---|
| `SMTP_*` | 邮件验证 |
| `WECHAT_APP_ID` / `WECHAT_MCH_ID` / `WECHAT_API_KEY` | 微信支付 |
| `ADMIN_EMAILS` | 管理员白名单 |
| `REDIS_URL` | Redis（推荐 Upstash） |
| `COMPOUND_ENABLED` | `true` |

---

## 5. 数据库迁移

EdgeOne 没有「migration 时机」概念，**必须在本地迁移完后再 push 代码**：

```bash
# 1. 本地临时指向腾讯云 PG
export DATABASE_URL="postgresql://interview:密码@xxx.tencentcloud.com:5432/interview_buddy?sslmode=require"

# 2. 推送 schema
pnpm prisma migrate deploy

# 3. 播种 Scenario 16 关（如果有 seed）
pnpm prisma:seed

# 4. 验证
pnpm prisma studio  # 浏览器看 11 张表是否齐全
```

之后 EdgeOne 部署时**不需要再 migrate**（schema 已就位）。

---

## 6. 部署触发

### 6.1 首次部署

1. EdgeOne 控制台点击「**部署**」
2. 等待 5-10 分钟（首次构建）
3. 查看构建日志（出问题可看 stack trace）
4. 成功后得到 `https://your-project.edgeone.app`

### 6.2 后续部署

- 推送到 `main` 分支 → EdgeOne 自动构建 + 部署
- PR → 自动生成 Preview URL

---

## 7. 域名 + HTTPS

### 7.1 免费域名（开发）

EdgeOne 自动分配：`*.edgeone.app` 子域名。

### 7.2 自定义域名（生产）

1. EdgeOne 控制台 → 「**域名管理**」→ 添加 `your-domain.com`
2. 按提示去域名注册商加 CNAME 记录
3. HTTPS 自动签发（Let's Encrypt）

### 7.3 ICP 备案（国内必做）

- 国内服务器域名必须 ICP 备案
- 腾讯云提供「**备案授权码**」（EdgeOne 可申请）
- 备案期间可用 EdgeOne 临时域名访问

---

## 8. 部署后验证

### 8.1 烟雾测试

```bash
DOMAIN="https://your-project.edgeone.app"

# 1. 首页
curl -sS -o /dev/null -w "%{http_code} (%{time_total}s)\n" "$DOMAIN/"
# 期望：200 (0.5s 内)

# 2. 静态页
curl -sS -o /dev/null -w "%{http_code}\n" "$DOMAIN/login"
curl -sS -o /dev/null -w "%{http_code}\n" "$DOMAIN/register"

# 3. API 鉴权（应返回中文 i18n envelope）
curl -sS "$DOMAIN/api/auth/me"
# 期望：{"ok":false,"error":{"code":"UNAUTHENTICATED","message":"未登录"}}

# 4. 测 SSE（需登录后）
curl -sS -N -H "Cookie: token=xxx" "$DOMAIN/api/interview/test-id/message" \
  -X POST -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
# 期望：SSE 流，包含 data: {...} 行
```

### 8.2 数据库连通

```bash
# 检查 EdgeOne 日志 → 找 DB 连接错误
# 验证：
curl -sS "$DOMAIN/api/auth/register" \
  -X POST -H "content-type: application/json" \
  -d '{"email":"test@example.com","password":"12345678","verifyCode":"000000"}'
# 期望：成功 / 邮箱已存在错误（不是 500）
```

### 8.3 AI 链路

```bash
# 用真实账号登录后创建面试
# 流式响应应在 5s 内返回第一个 chunk
```

---

## 9. 监控 + 故障排查

### 9.1 EdgeOne 控制台

- **构建日志**：每次构建完整 stdout/stderr
- **实时日志**：实时 tail 函数日志
- **指标**：QPS / 错误率 / P95 延迟

### 9.2 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| **Build 失败：Cannot find module '@prisma/client'** | 缺 `prisma generate` 步骤 | 构建命令加 `&& pnpm prisma generate` |
| **部署后 500：Connection refused** | DB 白名单没放行 EdgeOne IP | EdgeOne 文档找 IP 段或开 `0.0.0.0/0` |
| **SSE 60s 后断开** | EdgeOne Functions 默认 30s | 在 `edgeone.json` 配 `maxDuration: 60` |
| **PDF 上传 413** | 函数 body limit | next.config.js `serverActions.bodySizeLimit: '10mb'` |
| **JWT cookie 不持久** | EdgeOne 默认 secure cookie 需 HTTPS | 部署后用 https 访问 |

### 9.3 日志调试

```bash
# EdgeOne 控制台 → 实时日志
# 关键词：ERROR / Prisma / Auth / SSE

# 本地复现：
DATABASE_URL="..." pnpm dev
# 用真实环境变量调试
```

---

## 10. 上线 Checklist

- [ ] EdgeOne 项目创建完成
- [ ] 腾讯云 PG 实例就绪 + 白名单开放
- [ ] 本地 `prisma migrate deploy` 成功
- [ ] EdgeOne 环境变量全部填写（含 DATABASE_URL）
- [ ] GitHub 仓库已推送 main 分支
- [ ] 首次构建成功（控制台查看）
- [ ] 烟雾测试 6 路由 200
- [ ] API i18n envelope 全中文
- [ ] SSE 流式响应 30s 内不断
- [ ] AI 链路通（至少 minimax）
- [ ] 域名 + HTTPS 配置（生产）
- [ ] ICP 备案（国内生产必做）

---

## 11. 成本估算

| 项 | 试用阶段 | 正式阶段 |
|---|---|---|
| EdgeOne Pages | ¥0（免费层） | ¥0（免费层够用） |
| 腾讯云 PG 1 核 1GB | ¥0（1 个月试用） | ~¥50/月 |
| 域名 | ¥0（edgeone.app） | ~¥60/年 |
| ICP 备案 | ¥0（自做） | ¥0 |
| **合计** | **¥0** | **~¥50/月** |

---

## 12. 后续优化（PMF 后）

| 优化 | 收益 | 工作量 |
|---|---|---|
| 接入 VPC + 内网 DB | DB 延迟 -50% | 1 小时 |
| 接入 Upstash Redis | 限流 -90% | 2 小时 |
| CDN 缓存静态资源 | TTFB -30% | 30 分钟 |
| AI 响应预热 | 首字延迟 -40% | 4 小时 |
| 多区域部署 | 跨省延迟 -60% | 1 天 |

---

## 13. 联系

EdgeOne 部署问题：
- 官方文档：https://cloud.tencent.com/document/product/1552
- 蕾姆（女仆工程师）：随时待命

---

**附**：本指南基于 2026-07-14 EdgeOne Pages 实际能力，未来政策可能调整。