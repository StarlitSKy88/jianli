---
id: bugs-2026-07-23-8085
title: GET /api/admin/turnstile-status 通过 query 参数 ?email= 鉴权,任意用户绕过认证可读 admin 状态
category: bugs
severity: critical
tags: [auth, admin, query-string, bypass, security, owasp-a01]
created_at: 2026-07-23
project: interview-buddy

problem: |
  GET /api/admin/turnstile-status 之前用 query 参数鉴权:

  ```typescript
  // app/api/admin/turnstile-status/route.ts (修复前)
  const checkEmail = url.searchParams.get('email')?.toLowerCase();
  if (!checkEmail || !ADMIN_EMAILS.includes(checkEmail)) {
    return errorResponse('FORBIDDEN', 'admin only', 403);
  }
  ```

  **攻击路径**(任意未登录用户可执行):
  ```bash
  # 1. 攻击者知道任一 admin email(可从 git log / 域名 whois / admin doc 拿到)
  curl 'http://prod/api/admin/turnstile-status?email=admin@x.com'
  # → 200 + 暴露 siteKey / secret 状态 / NODE_ENV
  ```

  **风险**:
  - 泄露 prod NODE_ENV(辅助其他攻击)
  - 泄露 siteKey 前 12 位(辅助伪造前端 widget)
  - 泄露 secret 是否配置(辅助攻击决策)
  - 跟 /api/admin/models /api/admin/anchors 的 session.isAdmin() 鉴权**不一致**

  **OWASP 分类**: A01:2021 Broken Access Control
  **CVSS 评分**: ~5.3 (Medium-High,需配合 admin email 已知)
  **生产影响**: 自 2026-07 上线以来一直存在,期间未发现被利用痕迹

  **为什么没被早期发现**:
  - admin 路由完全没 E2E 测试覆盖,直到 Round 4 admin-e2e.sh 写出来
  - 边界压测只测 register/login/resume/interview/payment,没覆盖 admin

solution: |
  改用统一的 getSession() + isAdmin() 鉴权模式(同 models / anchors):

  ```typescript
  // app/api/admin/turnstile-status/route.ts (修复后)
  import { successResponse, errorResponse, getSession } from '@/lib/auth/middleware';

  function isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
  }

  export async function GET(req: NextRequest) {
    const session = await getSession(req);
    if (!session) {
      return errorResponse('UNAUTHENTICATED', '需要登录', 401, req);
    }
    if (!isAdmin(session.email)) {
      return errorResponse('FORBIDDEN', '需要管理员权限', 403, req);
    }
    // ...返回 turnstile 状态
  }
  ```

  **统一鉴权模式**:
  1. getSession() — 校验 cookie/JWT 拿到当前用户
  2. isAdmin(session.email) — 校验 email 在 ADMIN_EMAILS 白名单
  3. 任一失败 → 401/403(不暴露内部状态)

verification:
  unit: "vitest 219/219 passed,type-check 0 errors"
  integration: "tests/stress/admin-e2e.sh 9/9 全过"
  e2e: "A1 匿名 → 401 / A2 ?email= 绕过 → 401 / A3 登录但非 admin → 403 / A4-A8 普通用户访问 models/anchors → 401 或 403"

learned_from:
  - file: app/api/admin/turnstile-status/route.ts
  - test: tests/stress/admin-e2e.sh

debugging_trace: |
  1. Round 4 PLAN 阶段:侦察 admin 路由,看到 turnstile-status 第 20 行 query string 鉴权
  2. 对比其他 admin 路由(models/anchors)用 session 鉴权 → 明显不一致
  3. EXECUTE:写 admin-e2e.sh A1/A2 两个 case 验证
  4. 修复:getSession() + isAdmin() 统一鉴权
  5. 重跑 9/9 全过
  6. 回归 vitest 219/219 + type-check 0 errors

anti_pattern: |
  **禁止用 query 参数鉴权**:URL 会被浏览器历史/CDN 日志/Referer 头泄露,
  也无法验证请求方身份。任何鉴权必须基于 cookie/header,且必须验证签名。

  **禁止 admin 路由鉴权逻辑分叉**:每个 admin 路由必须用同一个 getSession + isAdmin
  模板。本次 bug 就是因为 turnstile-status "简化版"鉴权导致的不一致。

  **admin 路由必须 E2E 测试**:CRUD 路径必须有测试,否则这种鉴权漏洞永远抓不到。

follow_up:
  - DRY 违反: ADMIN_EMAILS + isAdmin() 在 6 个文件里重复定义,下一步提取到 lib/auth/admin.ts
  - 加 1 个单测:tests/unit/admin-auth.test.ts 验证 isAdmin 行为一致