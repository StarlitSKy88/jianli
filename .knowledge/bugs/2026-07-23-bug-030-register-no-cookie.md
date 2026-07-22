---
id: bug-2026-07-23-030
title: /api/auth/register 未签发 JWT cookie,新用户注册后即 UNAUTHENTICATED
category: bug
severity: critical
tags: [auth, register, jwt-cookie, mock-user-e2e, user-blocking]
created_at: 2026-07-23
project: interview-buddy

problem: |
  POST /api/auth/register 成功后,前端调用 GET /api/auth/me 永远返回
  {ok: false, error: {code: 'UNAUTHENTICATED'}}。新注册的用户无法直接进入
  /interview/new,必须再调一次 /api/auth/login 才能登录 — 流程断裂。

  **重现**:
  ```bash
  curl -c cookies.txt -X POST /api/auth/register -d '{email,password,verifyCode}'
  # → 201 {ok:true,data:{userId}}
  curl -b cookies.txt /api/auth/me
  # → 401 {ok:false,error:{code:'UNAUTHENTICATED'}}  ← BUG
  ```

  **根因**: register/route.ts 仅写库 + 返回 userId,完全没调用
  signSession + setAuthCookie。Cookie 是空的,前端拿不到 token,所有受保护
  API 全部拒绝。

  **影响范围**:
  - 新用户首次注册后无法直接进入产品,必须再登录一次
  - 测试 mock-user-e2e 首次跑发现这个 bug(register 返回成功但 /me 失败)
  - 历史上 prod 可能因此损失 N 个新用户(打开看到 401 后跳出)
  - 是典型的"代码能跑通但用户体验断裂"的隐藏 bug

  **为什么没被早期发现**:
  - vitest 单测只测 register 路由本身,没串联 /me
  - 之前的压测脚本(phase-14-1-concurrent.sh)是先 register 再 login,
    绕过了 bug — 但掩盖了真实问题
  - 没有"端到端用户旅程"测试覆盖,直到这次 10 用户模拟才暴露

solution: |
  在 register/route.ts 写库后、返回响应前,立即签发 JWT 并设 cookie:

  ```typescript
  // app/api/auth/register/route.ts (commit 9fabb6a)
  track(user.id, 'signup_complete', { email: email.replace(/(.{2}).*(@.*)/, '$1***$2') });

  // 自动登录：注册成功后立即签发 JWT 并设 cookie，避免前端需要再调一次 login
  // （这是 prod 流程，注册后应该直接跳到 /interview/new）
  const token = await signSession({ userId: user.id, email: user.email });
  const res = successResponse({ userId: user.id, email: user.email }, 201, req);
  setAuthCookie(res, token);
  return res;
  ```

  关键：必须在 track() 之后、return res 之前调用,且 setAuthCookie
  必须拿到的是 successResponse 的 res 对象(NextResponse),不是 Response。

verification:
  unit: "vitest 219/219 passed (auth.register / auth.session / auth.cookie 三件套单测全过)"
  integration: "curl -c cookies.txt -X POST register → -b cookies.txt /me → 200 {email: ...}"
  e2e: |
    tests/stress/mock-user-e2e.sh byte P6 后端工程师 → 9/9 section 全过 0 errors
    - register ✓ → /me ✓ → upload ✓ → interview ✓ → 5 轮对话 ✓ → complete ✓ →
      report ✓ → pay ✓ → feedback ✓ → logout ✓

learned_from:
  - commit: 9fabb6a
  - file: app/api/auth/register/route.ts
  - script: tests/stress/mock-user-e2e.sh

anti_pattern: |
  **禁止只测单路由而忽略串联**：register/login/me 是耦合的鉴权链路，
  任何一个不设 cookie 都会让整个用户旅程断在第一步。
  后续所有 auth 路由变更必须跑 mock-user-e2e.sh 验证 9-section 全过。

  **禁止测试脚本主动绕路**：phase-14-1-concurrent.sh 是 register→login
  双调用绕过了这个 bug,但掩盖了真实问题。e2e 测试应该走真实用户路径,
  不应在脚本里写"如果 register 失败就 fallback 到 login"。

debugging_trace: |
  1. mock-user-e2e.sh 首次跑(7/22): 6 个 errors
  2. 排查:section 1 register 返回 {ok:true,userId:...} 但 /me 失败
  3. 看 register/route.ts:只有 successResponse,没有 setAuthCookie
  4. 对比 login/route.ts:有 setAuthCookie — 所以 register 漏写
  5. 修复:从 login 复制 signSession + setAuthCookie 三行
  6. 重新跑 → 0 errors,9 section 全过