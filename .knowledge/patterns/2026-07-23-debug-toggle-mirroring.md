---
name: debug-toggle-mirroring
description: 调试环境开关 (DISABLE_RATE_LIMIT / USE_MOCK_AI / DISABLE_TURNSTILE) 必须一次性 mirror 到所有相关入口函数,否则会"抄一半"漏掉路径
metadata:
  type: pattern
  scope: lib/**, 全栈
  introduced_at: 2026-07-23
  introduced_in: Round 6 SSE 边界压测
  status: active
---

# 反模式:调试开关只抄一半 (Debug Toggle Mirroring Anti-Pattern)

## 问题 (Problem)

E2E 测试里我们用几个常用的"调试开关"绕过真实环境副作用:

| 环境变量 | 作用 | 期望行为 |
|---|---|---|
| `DISABLE_RATE_LIMIT=1` | 短路用户配额限流 | checkLimit 直接 allowed=true |
| `DISABLE_TURNSTILE=1` | 关闭人机验证 | turnstile 校验 pass-through |
| `USE_MOCK_AI=1` | 强制只用 mock AI | 不走真实 provider |
| `ENABLE_TEST_HELPERS=1` | 开放测试拿验证码 helper | /api/test-helper/* 可访问 |

这些开关通常在某次新需求里被引入,首个实现点加了短路,**复制粘贴到同类入口时容易漏一个**。

## 真实翻车案例 (Real Incidents)

### 案例 1: DISABLE_RATE_LIMIT 漏抄 (Bug-009, Round 6)

- `lib/auth/anti-abuse.ts#checkRateLimit` (IP 限流):✅ 读了 `DISABLE_RATE_LIMIT=1`
- `lib/utils/rate-limit.ts#checkLimit` (用户配额限流):❌ 没读
- 后果:`tests/stress/sse-boundary-tests.sh` E10 5 并发 finish 中,3 个被 429 拒
- 修复:给 `checkLimit` 加同样的短路

### 案例 2: USE_MOCK_AI 半强度 (Bug-008, Round 5)

- `lib/ai/router.ts#aiChat`:✅ 走了 mock 但仍按 priority 排最后,真实 provider 没 cooldown 时被选中
- 后果:mock 模式下真实 AI 返回 `  `污染评分
- 修复:USE_MOCK_AI=1 时强制 `available = mockOnly`

### 案例 3: TURNSTILE status 路径 (Bug-003, Round 4)

- 注册路径:✅ 加了 turnstile 校验短路
- `/api/auth/turnstile-status` query 路径:❌ 通过 `?email=` 无认证可绕过
- 修复:加 admin 鉴权

**3 个 bug 都是同一类——调试开关只在一个地方加,同类入口漏了**。

## 防御 (Defense)

### A. 写新调试开关时强制搜索同类入口

```bash
# 加新开关 X=1 时,先 grep 所有类似入口
grep -rn "process.env.X" lib/ app/

# 用 rg 找所有"读 env"的位置,人工对齐
rg "process\.env\.[A-Z_]+" --type ts
```

### B. 在 shared 入口加集中短路

不要每个函数自己读,搞一个 `lib/dev/shortcuts.ts`:

```typescript
// 单一真相,所有限流/鉴权/AI 入口都走这里
export function isTestEnvBypass(): boolean {
  return process.env.NODE_ENV !== 'production' &&
    process.env.DISABLE_RATE_LIMIT === '1';
}

// call site:
if (isTestEnvBypass()) return { allowed: true, ... };
```

未来加新开关只改一处,所有入口自动获得短路。

### C. 写 E2E 时随手跑 N 并发

任何 new feature 的 e2e 都应该至少跑一次 5 并发同一 user 操作:

- 5 个 finish 同时进 → 至少 1 个能正常评分 = 通过
- 5 个 resume upload 同时进 → 至少 4 个返回 200 = 通过

**这是发现"调试开关漏抄"的最便宜探针**。

### D. 知识卡 spawn 自动提示

在 `.knowledge/decisions/` 下写一张"调试开关源清单"卡,列:

```
DISABLE_RATE_LIMIT      → checkLimit (user), checkRateLimit (ip)
USE_MOCK_AI             → aiChat, aiStreamChat
DISABLE_TURNSTILE       → registerAction, loginAction, sendVerifyCodeAction
ENABLE_TEST_HELPERS     → /api/test-helper/* middleware
```

新加开关时**先更新源清单**,再写代码。

## 验证 (Verification)

- ✅ Bug-009:`checkLimit` 加 `DISABLE_RATE_LIMIT=1` 短路,E10 5 并发全 200
- ✅ Bug-008:`aiChat` 加 USE_MOCK_AI 强制 mock-only
- ✅ Bug-003:`turnstile-status` 加 admin 鉴权

## 相关 (Related)

- Bug 卡 `.knowledge/bugs/2026-07-23-checklimit-disableratelimit-not-read.md`
- Bug 卡 `.knowledge/bugs/2026-07-23-use-mock-ai-not-forcing-mock-only.md`
- 压测卡 `tests/stress/sse-boundary-tests.sh` (E10 race + E12 注入)

## 一句话 (One-liner)

**调试开关 = 反射面,要铺就铺到所有同构入口,否则你就是下一个 Bug-009 的受害者。**
