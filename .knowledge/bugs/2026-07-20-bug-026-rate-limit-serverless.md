---
id: bug-2026-07-20-026
title: 进程内 Map 限流在 serverless 多实例下失效
category: bug
severity: high
tags: [rate-limit, serverless, multi-tenant, edgeone, persistence]
created_at: 2026-07-20
project: interview-buddy

problem: |
  E2E agent #2 报告：lib/auth/anti-abuse.ts 用 `new Map<string, RateLimitBucket>()` 做
  IP 限流，EdgeOne Pages serverless 多实例 + 冷启动会让 Map 被清空 / 实例间不共享，
  攻击者换 IP 不换 UA 即可绕过 5 分钟 10 次登录限流。

root_cause: |
  Node.js 进程内 Map 不适合 serverless：
  - 每次冷启动 Map 重新初始化
  - 多实例间互不可见
  - 没有持久化层做"全局限流"

solution: |
  双层防御：
  - L1 in-memory bucket（保留）：单实例 burst 防护，< 1ms
  - L2 DB RateLimit（仅 prod）：跨实例 + 跨冷启动累计，写 prisma.rateLimit 表
    (userId='ip:key', resourceType='rate-limit-ip', windowStart)

  API：
  - 保留 checkRateLimit(key, maxHits, windowMs) sync 给 test/dev（仅 L1）
  - 新增 checkRateLimitAsync(key, maxHits, windowMs) 给 prod 路由（L1 + L2）
  - 6 个路由迁移到 async 版（login/register/send-verify-code/send-reset-code/reset-password/feedback）
  - L2 用 Promise.race 加 50ms 超时保护：DB 慢不阻塞业务
  - DB 失败 fall through 到 L1（L1 + 蜜罐 + Turnstile 三层防御仍生效）

  schema: prisma.rateLimit 表已存在（userId+resourceType+windowStart 复合唯一）

verification:
  unit: vitest 126/126 passed（feedback mock 加 checkRateLimitAsync）
  type: tsc 0 errors
  e2e: 需 Phase 15+ 真实多实例 burst 测试

learned_from:
  - file: lib/auth/anti-abuse.ts
  - file: prisma/schema.prisma (RateLimit model)

prevention:
  - serverless 部署下，**任何 in-memory state 都不可信**，必须 DB/Redis 持久化
  - 限流、计数器、session 缓存 → 必须 DB-backed
  - 保留 in-memory 作为 fast-path 缓存可接受（命中率高时），但不能作为唯一层