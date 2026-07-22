---
id: bugs-2026-07-23-8489
title: 6 个 admin 路由各自重复定义 isAdmin,5 处漏调 toLowerCase 导致 ADMIN_EMAILS 大小写与 session 不一致时鉴权失败
category: bugs
severity: high
tags: [auth, admin, dry, case-sensitivity, refactor]
created_at: 2026-07-23
project: interview-buddy

problem: |
  6 个 admin 路由(turnstile-status, models × 3, anchors × 2)各自重复定义 isAdmin:

  ```typescript
  // turnstile-status (有 toLowerCase)
  function isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
  }

  // models/route.ts, models/[id], models/[id]/test, anchors/route.ts, anchors/[id] (漏 toLowerCase)
  function isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return list.includes(email);  // ← 直接比对,没转小写
  }
  ```

  **触发场景**:
  - ADMIN_EMAILS="Admin@X.com,User@Y.COM" (env 里有人用大写)
  - session.email="admin@x.com" (DB/cookie 里是小写,常见)
  - turnstile-status → 200(有 toLowerCase,匹配成功)
  - models/anchors  → 403(漏 toLowerCase,匹配失败)
  → **同一个用户,不同 admin 路由表现不一致**

  **为什么是 High 而非 Critical**:
  - 不是任意绕过,是"配置不小心"才会触发
  - 但 admin 路由如果误判,PM/QA 无法维护 anchor/模型配置 → 业务阻塞

solution: |
  DRY 提取到 `lib/auth/admin.ts`,统一 toLowerCase + trim:

  ```typescript
  // lib/auth/admin.ts (新建)
  export const ADMIN_EMAILS: readonly string[] = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())  // ← env 也转小写
    .filter(Boolean);

  export function isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());  // ← 比对前也转
  }
  ```

  6 个 admin 路由全部改成:
  ```typescript
  import { isAdmin } from '@/lib/auth/admin';
  ```

  **新加单测 `tests/unit/admin-auth.test.ts` 锁定行为**:
  - 大小写不敏感(防 Bug-004 复发)
  - trim 处理空格邮箱
  - 过滤空字符串(防末尾逗号)
  - null/undefined 返回 false
  - env 未设置时返回 false
  → 8/8 passed

verification:
  unit: "vitest 227/227 passed (从 219 + 8 个 admin-auth 单测),type-check 0 errors"
  integration: "admin-e2e.sh 9/9 全过 (Bug-003 + DRY 重构后行为不变)"
  e2e: "6 个 admin 路由全部用同一份 isAdmin,行为绝对一致"

learned_from:
  - file: lib/auth/admin.ts
  - test: tests/unit/admin-auth.test.ts
  - commit: TBD

debugging_trace: |
  1. DRY 提取准备阶段,grep 发现 6 个文件各自定义 isAdmin
  2. 对比代码,发现只有 1 个文件(turnstile-status)有 toLowerCase
  3. 其他 5 个(models + anchors)漏了 toLowerCase
  4. 这种情况:大写 env + 小写 session → 鉴权失败
  5. DRY 提取顺便修了 Bug-004(默认行为正确)
  6. 加单测锁定,防未来又分叉

anti_pattern: |
  **禁止同一段逻辑在多个文件里"几乎相同"地重复**:
  - 抄来抄去时,微小的差异(toLowerCase vs 不调)很容易遗漏
  - 一旦遗漏,所有相关路由行为不一致,且难以排查
  - DRY + 单测 = 唯一彻底解法

  **admin/auth 鉴权代码必须放在 lib/auth/**:
  - 任何"业务方各自实现鉴权"的模式都会导致分叉
  - 统一的 isAdmin / getSession 应该是基础设施,不是业务方选择题

follow_up:
  - 检查 lib/auth/ 是否还有其他重复定义(checkRateLimit 等)
  - 考虑把所有 admin 路由文件里的 "session.email" 处理统一封装成 requireAdmin() helper