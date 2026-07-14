# Production Deployment Guide

> **Status**: ✅ Phase 8.3 Verified (2026-07-14)
> **Build**: `pnpm build` → 0 errors / 0 warnings / 17 routes / 87.4 kB First Load JS
> **Smoke test**: 全 17 路由 200 / API 鉴权链路完整 / i18n envelope 全中文

---

## 1. 部署目标对比

| 维度 | Vercel（推荐 MVP） | 自托管 Node | Docker |
|---|---|---|---|
| **上手时间** | 5 分钟 | 30 分钟 | 60 分钟 |
| **成本** | 免费层够用，超 ¥20/月起 | VPS ¥50/月起 | 镜像仓库 + 服务器 |
| **冷启动** | 0（Edge） | 无 | 无 |
| **SSE 流式支持** | ✅ 原生 | ✅ 需 sticky session | ✅ |
| **长连接（PDF 解析）** | ✅ Edge 25s 超时 | ✅ 无限制 | ✅ |
| **数据库** | Neon / Vercel Postgres | 自管 PG | 自管 PG |
| **Redis 限流** | Upstash | 自建 Redis | 自建 Redis |
| **HTTPS** | 自动 | 需自签 + 反代 | 需反代 |
| **环境变量** | Dashboard | .env / 容器 env | .env / k8s configmap |

**MVP 推荐**: **Vercel + Neon + Upstash**（零运维，5 分钟上线）。

---

## 2. 环境变量清单（生产必填）

### 🔴 必须（没有会 500）

| 变量 | 说明 | 示例 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（Neon 用 `?sslmode=require`） | `postgresql://user:pass@ep-xxx.aws.neon.tech/interview_buddy?sslmode=require` |
| `JWT_SECRET` | JWT 签名密钥（≥ 32 字符随机） | `openssl rand -hex 32` |
| `NODE_ENV` | 必须 `production` | `production` |

### 🟡 强烈推荐（缺则降级或功能不全）

| 变量 | 说明 | 默认 |
|---|---|---|
| `MINIMAX_API_KEY` | 主 AI Provider（没钱则降级） | 必填 |
| `ANTHROPIC_API_KEY` | 备用 AI | 降级兜底 |
| `DEEPSEEK_API_KEY` | 备用 AI | 降级兜底 |
| `MINIMAX_BASE_URL` | AI 端点 | `https://api.MiniMax.chat/v1` |
| `MINIMAX_MODEL` | AI 模型 | `MiniMax-M3` |
| `LLM_MAX_CONCURRENT` | 全局 LLM 并发上限 | `8`（高配可 16） |
| `NEXT_PUBLIC_APP_URL` | 公开应用 URL（回调用） | `https://your-domain.com` |
| `FREE_DAILY_QUOTA` | 每日免费面试次数 | `3` |
| `PAID_PRICE_CNY` | 单次价格（分） | `990` |

### 🟢 可选（高级功能）

| 变量 | 说明 |
|---|---|
| `REDIS_URL` | Redis 限流（不填则用 DB） |
| `SMTP_*` | 邮件验证（注册用） |
| `WECHAT_APP_ID` / `WECHAT_MCH_ID` / `WECHAT_API_KEY` | 微信支付（不填则 mock） |
| `ADMIN_EMAILS` | 管理员邮箱白名单（逗号分隔） |
| `COMPOUND_ENABLED` | 复利工程开关 | `true` |
| `KNOWLEDGE_DIR` | 经验卡目录 | `.knowledge` |

### ❌ 禁止提交

- `.env.local` / `.env.production` — 已加 `.gitignore`
- 任何含真实 key 的 YAML / JSON / 截图

---

## 3. Vercel 部署（推荐）

### 3.1 准备

```bash
# 1. 确认无 git 历史泄露
git log --all --full-history -- .env.local
# 应为空

# 2. 确认 build 通过
pnpm build
# 应显示：✓ Compiled successfully / 0 warnings

# 3. 推送代码到 GitHub
git remote add origin git@github.com:your-org/interview-buddy.git
git push -u origin main
```

### 3.2 Vercel 配置

1. https://vercel.com/new 选 `interview-buddy` repo
2. **Build Command**: `pnpm build`（自动识别）
3. **Install Command**: `pnpm install --frozen-lockfile`
4. **Output Directory**: `.next`（自动）
5. **Environment Variables**（参考第 2 节，逐项添加）
6. Deploy

### 3.3 必做后期配置

- [ ] **Database**: 接入 Neon（Vercel Marketplace 一键）
- [ ] **Redis**: 接入 Upstash（Vercel Marketplace 一键）
- [ ] **Domain**: 自定义域名 + DNS
- [ ] **Secrets**: `vercel env pull` 验证本地一致
- [ ] **Function Region**: 选 `hkg1`（国内近）

---

## 4. 自托管 Node 部署

### 4.1 系统要求

- Node.js ≥ 20.x LTS
- PostgreSQL ≥ 14
- （可选）Redis ≥ 6
- 2 vCPU / 2 GB RAM 起步

### 4.2 步骤

```bash
# 1. 拉代码
git clone <repo> /opt/interview-buddy
cd /opt/interview-buddy

# 2. 装依赖
pnpm install --frozen-lockfile

# 3. 编译
pnpm build

# 4. 数据库迁移
pnpm prisma migrate deploy

# 5. 准备 .env.production
cp .env.local.example .env.production
$EDITOR .env.production   # 填真实值

# 6. systemd 服务
cat > /etc/systemd/system/interview-buddy.service << 'UNIT'
[Unit]
Description=interview-buddy Next.js
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/interview-buddy
EnvironmentFile=/opt/interview-buddy/.env.production
ExecStart=/usr/bin/pnpm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl enable --now interview-buddy
```

### 4.3 Nginx 反代

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSE / 长连接支持
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 5. 健康检查

```bash
# Liveness
curl -fsS https://your-domain.com/ | grep -q "面试陪练"

# Readiness（DB 通）
curl -fsS https://your-domain.com/api/auth/me
# 应返回 {"ok":false,"error":{"code":"UNAUTHENTICATED","message":"未登录"}}

# AI 链路（需 ADMIN_EMAILS 配置）
curl -fsS https://your-domain.com/api/admin/models
# 同上，未登录 → UNAUTHENTICATED
```

---

## 6. 监控关键指标

| 指标 | 阈值 | 工具 |
|---|---|---|
| 首页 TTFB | < 500ms | Vercel Analytics / Datadog |
| API P95 | < 1.5s | 同上 |
| LLM 限流队列长度 | < 10 | `llmStats()` 自查 |
| 4xx 比例 | < 5% | Vercel Logs |
| 5xx 比例 | < 0.5% | 必须告警 |
| 付费转化率 | 监控 funnel | PostHog / Mixpanel |

---

## 7. 故障演练（必做）

| 场景 | 模拟 | 预期恢复 |
|---|---|---|
| LLM 限流打满 | 50 并发调用 aiChat | 8 in-flight，余下排队，队列长度可查 |
| 数据库断开 | Neon 切流 | 接口 5xx，前端降级"系统繁忙" |
| 微信支付回调丢失 | mock 跳过 webhook | mock URL 仍可用（仅 dev） |
| Redis 挂 | 杀掉 redis | 自动降级 DB 限流 |
| JWT 泄漏 | rotate JWT_SECRET | 旧 token 全失效（设计如此） |

---

## 8. 上线 Checklist

- [ ] `pnpm build` 0 warnings
- [ ] `pnpm test` 全绿（58/58 + E2E 13/13）
- [ ] `.env.production` 填写完整
- [ ] `JWT_SECRET` 用 `openssl rand -hex 32`
- [ ] 数据库 migration 跑过
- [ ] 域名 + HTTPS 就绪
- [ ] 监控 + 告警就绪
- [ ] 备份策略（Neon 自动 + 手动 snapshot）
- [ ] 灰度策略（Vercel Preview Deployments）
- [ ] 回滚方案（Vercel 一键 / systemd 旧 commit）

---

## 9. 后续 Roadmap

| 项 | 优先级 | 阻塞 |
|---|---|---|
| 真实邮件（替换 mock verifyCode） | P1 | 业务邮件到达率 |
| 真实微信支付（替换 mock） | P1 | 商户号 ICP 备案 |
| 16 关分桶（按公司独立配额） | P2 | BI 数据 |
| structured logger（替换 console） | P2 | 运维成本 |
| Redis 限流（替换 DB upsert） | P3 | 高并发后 |

---

## 10. 联系

部署问题 → 在 `docs/PRODUCTION_DEPLOY.md` 提 issue 或联系蕾姆（女仆工程师）。