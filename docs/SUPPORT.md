# 客服通道与用户反馈运营 SOP

> 适用版本：jianli.taomyst.top（EdgeOne Pages + TiDB Cloud）
> 创建日期：2026-07-15
> 维护人：客服 / 运营 / 开发 oncall

---

## 1. 客服通道总览

| 渠道 | 地址 | 接通时间 | 备注 |
|------|------|----------|------|
| 浮窗反馈 | 全站右下角 💬 | 即时 | 写入 `feedbacks` 表 + 邮件通知 support |
| 邮件直投 | support@taomyst.top | 即时 | 用户从 footer 点击"联系我们"唤起邮件客户端 |
| ICP 备案主体 | 京ICP备2025108350号-2 | — | 法定主体查询 |

**所有渠道最终汇总**：admin 在控制台查 `feedbacks` 表 → 回复用户。

---

## 2. 用户视角：浮窗反馈

用户操作流程（截图见附图）：
1. 点右下角蓝色 💬 按钮 → 弹出抽屉
2. 选「反馈类型」（BUG/UX/FEATURE/ACCOUNT/OTHER）
3. 写「内容」（5-2000 字）
4. 选填「联系邮箱」（用于回复）
5. 提交 → 看到 ✅ 反馈已收到 → 3-5s 自动关闭

**两次同流程**对运营：
- 写 `feedbacks` 表（已登录用户关联 userId / 匿名只记 IP）
- 邮件发到 `support@taomyst.top`（邮箱可通过 `FEEDBACK_NOTIFY_EMAIL` env 改）

---

## 3. 运营 SOP

### 3.1 查反馈列表

**方式 A：管理后台**（推荐，未来 #153 admin GET 实现）

**方式 B：直接 SQL**（MVP 临时）
```sql
-- TiDB 控制台 → SQL Editor
SELECT id, category, LEFT(content, 80) AS summary,
       userId, contactEmail, ipAddress, status,
       createdAt, resolvedAt, adminNote
FROM feedbacks
WHERE status = 'PENDING'
ORDER BY createdAt DESC;
```

### 3.2 回复用户

按 `contactEmail` 字段：
- 字段有值 → 发邮件到该邮箱，引用 feedback id 让用户能找回上下文
- 字段为空（匿名） → 站内回不了，**不要回复无意义**；可在 adminNote 备注，无法联系用户时改状态为 `RESOLVED` 说明"无联系方式，已处理"

### 3.3 标记 resolved

```sql
UPDATE feedbacks
SET status = 'RESOLVED',
    resolvedAt = NOW(),
    resolvedBy = '<admin userId>',
    adminNote = '<处理说明>'
WHERE id = '<feedbackId>';
```

**状态枚举**：`PENDING` | `IN_PROGRESS` | `RESOLVED` | `SPAM`

### 3.4 反垃圾（SPAM）

- 命中蜜罐 → 表里不会落数据（假装成功），运营无需处理
- IP 限流命中 → 返回 429，日志可见 + alerts；**不要去表里改 SPAM 状态**（根本没写入）
- 单条反馈是**真用户还是机器人**：
  - 真用户：content 通常有具体场景描述、分类选 `BUG`/`UX`
  - 机器人：通常是不通顺的英文广告 / 完全没有意义的内容 → 标记 `SPAM`

---

## 4. 应急与监控

### 4.1 /api/feedback 异常

| 现象 | 可能根因 | 应急 |
|------|----------|------|
| 500 | DB 连不上 | 检查 TiDB 控制台是否 suspended（流量超额）|
| 邮件全部 500 | SMTP/SES 密钥过期 | 查 EdgeOne 后台 env，重启 + 重发 |
| 浮窗打不开 | JS bundle 加载失败 | 强制刷新 / 查 EdgeOne 部署状态 |

### 4.2 监控项

- ✅ `/api/health` 已有：DB up + AI 启用数
- ❌ `/api/feedback` 暂无 UptimeRobot 监控（POST 不适合 HTTP ping）
  - 暂用 EdgeOne 函数日志搜 `POST /api/feedback 200` / `500` 计数
- 后续可加：1 min 内失败 > 10 → 邮件告警（oncall@taomyst.top）

---

## 5. 隐私与合规

- ❌ **不在反馈里问**用户婚否 / 有无子女 / 是否有房 / 户籍（违反《就业促进法》第 27 条）
- ✅ 邮箱仅用于回复；用户没留就不主动获取
- ✅ 用户可在反馈同时提供 userId（已登录），运营可在系统中关联用户档案
- ❌ 用户撤回反馈：当前未提供 UI 接口，技术上可一键 UPDATE `SET content = '[已撤回]'`

---

## 6. 变更日志

- **2026-07-15 — Phase 13.5 客服通道初版**：
  - 表 `feedbacks`（已推送 TiDB） + 全局浮窗 widget + `/api/feedback` 路由
  - 邮件通知走 `sendFeedbackNotification`（Console / SES 双通道）
  - 防刷三件套：蜜罐 + IP 限流（5/小时）+ Turnstile（dev 旁路）
  - 13 单测覆盖（6 邮件 + 7 API）全部通过
