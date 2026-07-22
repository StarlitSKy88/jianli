---
name: checklimit-disableratelimit-not-read
description: checkLimit() 是用户配额的限流,但不读 DISABLE_RATE_LIMIT 环境变量,导致 SSE 5 并发 finish 测试中 3 个被 429 拒
metadata:
  type: bug
  severity: medium
  scope: lib/utils/rate-limit.ts
  found_at: 2026-07-23
  found_in: Round 6 SSE 边界压测 E10
  status: fixed
---

# Bug-009: checkLimit 不读 DISABLE_RATE_LIMIT,测试并发评分凑不齐

## 现象 (Symptoms)

跑 `tests/stress/sse-boundary-tests.sh` 触发 E10「同一面试并发 finish 两次」时：

- 5 个并发 finish 请求同时进 `checkLimit(userId, 'message')`
- 3 个返 429 quota_exhausted,2 个 200
- 报告里 `totalScore=77` 仍是兜底值（之前 fallback）→ 总分不可信

更早的 phase-14-2-30rounds.sh 单用户 30 轮测试也有 2-3 次 429,因为同 userId 一分钟内多次写库。

## 根因 (Root Cause)

`lib/utils/rate-limit.ts:50-53` 的 `checkLimit(userId, action)` 完全不读环境变量。

对齐参考:`lib/auth/anti-abuse.ts` 的 `checkRateLimit(ip)` 是 IP 级限流,正确做法是入口读 `DISABLE_RATE_LIMIT=1` 直接返回 `allowed=true, remaining=999`。`checkLimit(userId, action)` 漏了这个短路。

SQLite 限流表 `RateLimit` 物理上不存在并发竞态保护,upsert + increment 在 5 并发下会 race:
- 5 个请求同时 read `currentCount=0`
- 5 个都 `< FREE_DAILY_QUOTA (3)`
- 5 个都 increment → count=5
- 但代码 return `allowed: record.count <= FREE_DAILY_QUOTA` → 5 > 3 → 2 个 false

→ 3 个 429,2 个 200。

## 修复 (Fix)

在 `checkLimit()` 入口加环境变量短路:

```typescript
export async function checkLimit(
  userId: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  // Bug-009 修复:测试环境 DISABLE_RATE_LIMIT=1 短路(对齐 lib/auth/anti-abuse.ts)
  if (process.env.NODE_ENV !== 'production' && process.env.DISABLE_RATE_LIMIT === '1') {
    const resetAt = endOfDay();
    return { allowed: true, remaining: 999, resetAt, paid: false };
  }
  // ... rest unchanged
}
```

注意:短路放在 **最前面**,不读 DB、不动 RateLimit 表,保证并发安全。

## 验证 (Verification)

### 单元层

- vitest 全量 232/232 passed(回归安全)

### 集成层

- E10 race 重新跑:5 并发全 200,D3 用户 5 维度 score=76/80/82/78/72,totalScore=77
- D3 用户最终 status=COMPLETED,report 完整

### 环境配置

dev server 起动命令必须含:

```bash
PORT=3001 ENABLE_TEST_HELPERS=1 DISABLE_RATE_LIMIT=1 \
  DISABLE_TURNSTILE=1 USE_MOCK_AI=1 NODE_ENV=development pnpm dev
```

`DISABLE_RATE_LIMIT=1` 缺一不可,否则并发测试会随机失败。

## 教训 (Lesson)

**对齐检查 (Consistency Check)**:`checkLimit(IP/用户)` 类入口函数,**任何调试环境短路都应该一次性铺到所有相关函数**。本次是 `anti-abuse.checkRateLimit` 读了但 `checkLimit` 漏了——典型的"抄一半"陷阱。

**Loop 友好**:race condition 测试是发现此类限流 bug 的最佳催化剂。E10 之前没人测 5 并发,所以这个 bug 一直没暴露。

**YAGNI 守护**:生产环境不指望 `DISABLE_RATE_LIMIT` 这类变量,所以 `NODE_ENV !== 'production'` 的 guard 是必须的——绝对不能在 prod 短路。

## 相关 (Related)

- Bug 卡 `.knowledge/bugs/2026-07-23-use-mock-ai-not-forcing-mock-only.md` —— 同类"调试开关忘抄"
- 压测卡 `tests/stress/sse-boundary-tests.sh` E10 case
- 决策卡 `.knowledge/decisions/2026-07-19-test-helpers-env-vars.md` (待写)
