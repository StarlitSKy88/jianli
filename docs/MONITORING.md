# 监控告警与数据备份 Runbook

> 适用版本：jianli.taomyst.top（EdgeOne Pages + TiDB Cloud Serverless）
> 创建日期：2026-07-15
> 维护人：开发团队

---

## 1. 健康检查 Endpoint

应用内置 **`/api/health`**，公开访问、无需鉴权，返回 JSON：

```json
{
  "ok": true,
  "version": "0.1.0",
  "env": "production",
  "db": "up",
  "dbLatencyMs": 23,
  "ai": {
    "enabled": ["minimax", "openrouter", "deepseek"],
    "total": 4
  },
  "ts": "2026-07-15T13:36:47.968Z"
}
```

**字段含义：**

| 字段 | 类型 | 含义 |
|------|------|------|
| `ok` | bool | 全栈健康：DB up + 至少 1 个 AI provider 已配 |
| `db` | string | `"up"` / `"down"` |
| `dbLatencyMs` | number | SELECT 1 实际耗时（监控 DB 性能趋势用） |
| `ai.enabled` | string[] | 当前已启用 AI providers 名称列表（不暴露 keys） |
| `ai.total` | number | 系统支持的 provider 总数 |
| `warn` | string? | 非阻塞告警（如 `"NO_AI_PROVIDER"`） |

**HTTP 状态码：**
- `200` — 健康
- `503` — DB down 或全部 AI provider 未配

---

## 2. UptimeRobot 监控接入步骤

### 2.1 注册账号

1. 访问 <https://uptimerobot.com> → Sign Up（免费层够用）
2. 验证邮箱

### 2.2 添加 Monitor

| 字段 | 值 |
|------|------|
| Monitor Type | HTTP(s) |
| Friendly Name | `jianli-taomyst-top` |
| URL (or IP) | `https://jianli.taomyst.top/api/health` |
| Monitoring Interval | 5 minutes |
| Timeout | 5 seconds |
| HTTP Method | GET |
| Keyword Value | `"ok":true` |
| Alert Contacts | 邮件（开发团队 + support@taomyst.top） |

**关键点**：
- 必须用 `/api/health` 而非 `/` —— 首页是 SSR SPA bundle，EdgeOne 冷启动 3-5s，会误报宕机
- Keyword 检查 `"ok":true` —— 即使整个 app 慢也不误报（只要响应 JSON 里有 ok:true 就算活）
- 5min 频率 —— 免费层 50 monitors，间隔不低于 5min

### 2.3 验证

注册后等待约 5 分钟，UptimeRobot Dashboard 会显示：
- ✅ `Up` 标记
- Response time chart
- Uptime % (last 24h / 7d / 30d)

如果一直 **Down**：
1. 在浏览器手动访问 `https://jianli.taomyst.top/api/health`
2. 看返回内容（可能是 json parse 错误 / proxy 502）
3. 联系 EdgeOne 控制台看 Functions 日志

---

## 3. TiDB Cloud 数据备份

### 3.1 自动备份（默认启用）

**TiDB Cloud Serverless** 自动包含：
- ✅ 每日自动备份（UTC 00:00）
- ✅ 保留期 **7 天**（Serverless 默认；可付费升级到 30/90 天）
- ✅ Point-in-Time Recovery（PITR）—— 7 天内任意时间点恢复

**配置查看**：
- 控制台：<https://console.tidbcloud.com> → Cluster → Backups
- 应看到 daily snapshot + binlog 记录

### 3.2 手动备份（应急用）

```bash
# 用 mysqldump 备份整个 schema
mysqldump -h gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com \
  -P 4000 \
  -u '<username>' \
  -p'<password>' \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  jianli > backup-$(date +%Y%m%d).sql

# 恢复
mysql -h <host> -P 4000 -u <user> -p<pwd> jianli < backup-20260715.sql
```

**注意**：
- `mysqldump` 走 public endpoint，平均 2-5min（取决于数据量）
- 必须在白名单 IP 列表（EdgeOne Functions IP 或本地办公 IP）
- 不推荐频繁手动备份 —— Serverless 自动备份已覆盖日常

### 3.3 灾难恢复 Playbook

1. **数据被误删（最近 7 天）**
   - 控制台 → Backups → 选最近一次快照 → Restore to new cluster
   - 测试后切回主集群

2. **数据被严重损坏**
   - 先 snapshot 当前状态（保留现场）
   - 联系 TiDB Cloud Support（付费层 SLA 1h）

3. **EdgeOne 函数漏数据**
   - 检查 `app/api/interview` / `app/api/resume/upload` 等 POST 路由日志
   - 看是否有 5xx 但客户端 retry 失败

---

## 4. 应急响应流程

### 4.1 故障分级

| 级别 | 描述 | 响应时间 | 负责人 |
|------|------|----------|--------|
| P0 | 全站宕机（UptimeRobot alert） | 30min | 开发 oncall |
| P1 | AI 对话不可用（mock/真实全部失败） | 2h | 开发 oncall |
| P2 | DB 慢/有部分错误 | 8h | 开发 oncall |
| P3 | UI 小 bug | 48h | 排期 |

### 4.2 P0 Playbook

1. **确认范围**：UptimeRobot Dashboard 看 alert 内容
2. **访问 health endpoint**：
   ```bash
   curl -i https://jianli.taomyst.top/api/health
   ```
3. **查看 EdgeOne 部署状态**：
   - <https://console.tencentcloud.com/edgeone> → Pages → Deployments
   - 看最近 deployment 是否 failed
4. **EdgeOne Functions 日志**：
   - 控制台 → Pages → Functions → Logs
   - 过滤 status>=500 看错误堆栈
5. **如果是 DB down**：
   - TiDB 控制台 → Cluster → Status
   - 看是否 cluster is suspended（流量超额会暂停）
6. **回滚**（如最近 deploy 有问题）：
   - EdgeOne 控制台 → Deployments → 选上一个 stable → Redeploy

### 4.3 P1 Playbook（AI 失败）

1. **确认 health endpoint 的 ai.enabled**：
   ```json
   "ai": { "enabled": [], "total": 4 }
   ```
   如果 enabled 是空 → 某个 provider env 没设
2. **看 dev log**：
   ```bash
   grep -E "ai-router.*failed" logs/*.log | tail -20
   ```
   找是不是 402/429 quota 耗尽
3. **修复**：
   - env 缺失 → 在 EdgeOne 控制台追加环境变量
   - quota 耗尽 → 切换 fallback 模型（见 openrouter.ts 的 OPENROUTER_FALLBACK_MODELS）
   - 真挂 → 临时 `USE_MOCK_AI=1` 让用户体验不中断

### 4.4 通知联系人

| 角色 | 联系方式 |
|------|----------|
| 开发 | 邮件 oncall@taomyst.top（开发组邮件组） |
| 客服 | 邮件 support@taomyst.top |
| 业务 | 邮件 hello@taomyst.top |

UptimeRobot Alert Contact 配：**开发 + 客服两个** 邮件组双发，避免漏掉。

---

## 5. 监控指标（手动仪表盘）

### 5.1 关键指标（每周看一次）

| 指标 | 来源 | 健康阈值 |
|------|------|----------|
| EdgeOne 函数错误率 | EdgeOne 控制台 → Logs → filter status=500 | < 0.5% |
| DB 慢查询 (>1s) | TiDB 控制台 → Slow Queries | < 5/min |
| AI provider 失败率 | `grep "ai-router.*failed"` 在 EdgeOne 函数日志 | < 10% |
| UptimeRobot Uptime % | UptimeRobot Dashboard | > 99.5% |

### 5.2 容量预警

- **TiDB Serverless 用量**：控制台顶部 → monthly usage
  - 80% 时通知
  - 100% 时 cluster 自动 throttle
- **EdgeOne Functions 调用量**：控制台 → Usage → Functions
  - 免费层 100k req/月；超出后 $0.50/M requests

---

## 6. 自动化告警清单

| 触发条件 | 渠道 | 收件人 |
|----------|------|--------|
| 5min 内 3 次连续 health check 失败 | Email | 开发 oncall |
| 单小时 50+ 错误 | Email | 开发 oncall |
| 新 deployment 失败 | Email | 开发 oncall |
| TiDB 用量 > 80% | Email | 业务 + 开发 |
| Domain SSL 证书 < 14 天过期 | Email | 开发 oncall |

---

## 7. 复盘节奏

- **每周一次**（15min）：oncall 同步故障处理 + 改进项
- **每月一次**（30min）：看 metrics，决策容量扩容
- **每季度一次**（1h）：runbook 更新 + 演练一次应急响应

---

**变更历史**：
- 2026-07-15：初版（Phase 13.3 收尾）
