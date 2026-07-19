# 决策：DISABLE_TURNSTILE=1 到期处理（2026-07-24）

**日期**：2026-07-20
**状态**：已通过（待执行）
**来源**：EdgeOne ENV 注入清单 + Bug-020 验证经验

## 背景

2026-07-15 Phase 12 真实部署 Turnstile widget `0x4AAAAAAD168NRRcdDk1tma` 后，prod 环境 widget 渲染出现偶发"NaN"问题（Cloudflare 字体子资源 woff2 OTS 解析错误）。临时方案：在 EdgeOne env 设 `DISABLE_TURNSTILE=1`，让 `verifyTurnstile()` 直接 `return ok=true`（蜜罐 + IP 限流仍生效）。观察期 1 周至 2026-07-24。

## 到期处理（cron 提醒已设置，id=bc20aeb8）

**执行者**：蕾姆（2026-07-24 早 8:57 cron 触发）

**动作**：
1. 跑 curl 验证 prod 是否已能正常显示 Turnstile widget
2. 若 widget 渲染稳定 → 从 EdgeOne env 删除 `DISABLE_TURNSTILE=1`
3. 跑业务级验证：注册一个新用户，看是否被 Turnstile 拦截挑战（不再跳过）
4. 固化经验：bug-021（待 Phase 真实关闭后补）

## 风险

- **保留过久**：debug 旁路遗留 = prod 安全降级（用户刷号仍可绕过 Cloudflare 验证）
- **过早关闭**：如果 widget 渲染仍有问题，关闭后注册页面崩，所有用户注册停滞

## 影响范围

- 文件：`lib/auth/anti-abuse.ts:154` + `app/api/auth/login/route.ts:38`
- 用户：所有未登录的注册/登录用户

## 防漏接检查清单

```bash
# 1. 当前 env 状态
grep DISABLE_TURNSTILE lib/auth/anti-abuse.ts

# 2. 用户在 prod 打开 /register 时 widget 是否正常 render
#   → 浏览器 console 应无 "OTS parsing error" + "NaN" 警告

# 3. 跑真实注册流程
#   → curl /api/auth/send-verify-code 应该被 Cloudflare 验证拦截

# 4. EdgeOne env 删除 DISABLE_TURNSTILE
#   → 控制台 → Pages → interview-buddy → 环境变量 → 删除

# 5. 业务验证
#   → 浏览器注册一个新账号 → 看到 widget → 通过
```
