---
id: bug-2026-07-23-031
title: 重复 register email 已注册时返回 400 而非 409,顺序错
category: bug
severity: medium
tags: [auth, register, existing-check, verify-code, ordering, boundary]
created_at: 2026-07-23
project: interview-buddy

problem: |
  POST /api/auth/register 当 email 已注册时,返回 400 VERIFY_CODE_INVALID
  而非 409 EMAIL_TAKEN。

  **重现**:
  ```bash
  # 1) 先注册 a@x.com (正常)
  POST /api/auth/register {email:a@x.com,password:Test1234!,verifyCode:真码}
  # → 201

  # 2) 再注册 a@x.com (任何 verifyCode 都应返回 409)
  POST /api/auth/register {email:a@x.com,password:Test1234!,verifyCode:000000}
  # → 400 VERIFY_CODE_INVALID  ← BUG（应 409 EMAIL_TAKEN）
  ```

  **根因**: app/api/auth/register/route.ts 的校验顺序错：
  ```
  ① verifyCode 校验 → ② existing check
  ```
  第二次 register 的 verifyCode 是错的,被 ① 拦了,没走到 ② 的
  EMAIL_TAKEN 检查。用户看到 "验证码错误" 完全摸不着头脑——他根本不该
  需要验证码。

  **副作用**:
  - 已注册邮箱会被无意义消耗验证码配额(攻击者可借此骚扰)
  - UX 错误提示:用户以为验证码错了会去重新发码,浪费一次发码 + 60s cooldown
  - 未来若加短信验证码会浪费短信费

  **为什么没被早期发现**:
  - vitest 单测只测"正确验证码 + 新 email"成功路径
  - 没覆盖"重复 email"边界,直到 boundary-tests.sh E1 暴露

solution: |
  把 existing check 前置到 verifyCode 校验前：
  ```typescript
  // app/api/auth/register/route.ts (commit TBD)
  const { email, password, verifyCode } = parsed.data;

  // 2) 已注册检查（前置：避免已注册邮箱消耗验证码 + 返回更精确的 409）
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true, passwordHash: true },
  });
  if (existing && existing.passwordHash && existing.passwordHash.length > 0) {
    return errorResponse('EMAIL_TAKEN', '该邮箱已注册', 409, req);
  }

  // 3) 校验验证码（真实流程）
  const verification = await consumeVerifyCode(email, verifyCode);
  ...
  ```

  **关键原则**: 业务校验应按"信息明确度从高到低"排列：
  1. 格式校验（zod schema）
  2. 业务唯一性校验（existing / unique constraint）
  3. 凭证校验（verifyCode / password）
  4. 副作用（写库、签发 token）

  把"业务唯一性"放最前,返回的 error code 最贴近用户真实问题。

verification:
  unit: "vitest 219/219 passed,type-check 0 errors"
  integration: "boundary-tests.sh E1: 第二次 register 同 email → 409 EMAIL_TAKEN ✅"
  e2e: "10 用户 mock-user-e2e 全部仍然 0 errors(未引入新 bug)"

learned_from:
  - file: app/api/auth/register/route.ts
  - test: tests/stress/boundary-tests.sh

debugging_trace: |
  1. boundary-tests.sh E1 跑出 HTTP=400 VERIFY_CODE_INVALID(期望 409)
  2. 看 register/route.ts:验证顺序是 consumeVerifyCode → existing check
  3. 顺序颠倒:把 existing check 提到 verifyCode 校验前
  4. 重跑 boundary-tests.sh → 10/10 ✅
  5. 回归 vitest 219/219 ✅

anti_pattern: |
  **禁止先校验凭证再校验唯一性**：会泄露凭证(攻击者用任意密码枚举 email 是否注册),
  也会误导用户(已注册用户看到"密码错误"而不是"邮箱已注册")。

  **校验顺序原则**：业务校验按信息明确度从高到低：格式 → 唯一性 → 凭证 → 副作用。