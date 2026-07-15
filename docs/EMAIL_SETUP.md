# EdgeOne Pages 环境变量注入脚本

> **创建日期**：2026-07-15
> **用途**：把 `.env.production` 的 key=value 解析出来，给 EdgeOne 控制台注入

---

## 用法

```bash
# 在项目根目录
pnpm tsx scripts/edgeone-inject-env.ts [env-file]
# 默认 .env.production
```

## 输出样例

```
📦 从 .env.production 解析出 5 个环境变量：

  EMAIL_SENDER_MODE            production
  SMTP_HOST                    gz-smtp.qcloudmail.com
  SMTP_PORT                    465
  SMTP_USER                    nodemailer@taomyst.top
  SMTP_PASSWORD                ***

🔐 标记为 Secret 的变量： ['SMTP_PASSWORD']

📌 实际注入请到 EdgeOne 控制台执行：
   Pages → 项目 → 环境变量 → 粘贴以上 key/value

   或使用 EdgeOne CLI:
   edgeone pages env set --key EMAIL_SENDER_MODE --secret false
   edgeone pages env set --key SMTP_HOST --secret false
   ...
```

## 限制

- 这是**辅助打印**，不是真注入（CLI 命令可能因 EdgeOne 版本变化）
- 真注入必须到控制台：https://console.cloud.tencent.com/edgeone/pages
- `SMTP_PASSWORD` / `JWT_SECRET` / `TURNSTILE_SECRET_KEY` 等必须标记为 Secret
