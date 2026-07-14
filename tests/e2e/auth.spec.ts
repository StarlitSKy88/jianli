/**
 * E2E Flow 1: 注册 → 登录 → /api/auth/me
 */
import { test, expect } from '@playwright/test';

const TEST_EMAIL = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
const TEST_PASSWORD = 'test123456';

test('register then /api/auth/me returns user', async ({ page, request }) => {
  // 用 page 注册以保留 cookie，然后通过 page.context 共享
  await page.goto('/register');
  await page.fill('input[type=email]', TEST_EMAIL);
  await page.fill('input[type=password]', TEST_PASSWORD);
  await page.fill('input[placeholder*="验证码"]', '000000');
  // 勾选「同意《用户协议》和《隐私政策》」checkbox（P0 法律合规）
  await page.check('input[type=checkbox]');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/interview\/new/, { timeout: 30_000 });

  // 在 page 上下文中直接 fetch，cookie 自动带上
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/auth/me');
    return { status: r.status, body: await r.json() };
  });
  expect(me.status).toBe(200);
  // /me 返回 { ok: true, data: <user> } — data.* 平铺，无 user 嵌套
  expect(me.body.data?.email).toBe(TEST_EMAIL);
});

test('login with wrong password → 401', async ({ request }) => {
  const r = await request.post('/api/auth/login', {
    data: { email: TEST_EMAIL, password: 'wrongpassword' },
  });
  expect(r.status()).toBe(401);
});

test('register with short password → 400', async ({ request }) => {
  const r = await request.post('/api/auth/register', {
    data: { email: `e2e-bad-${Date.now()}@test.local`, password: '123', verifyCode: '000000' },
  });
  expect(r.status()).toBe(400);
});

test('home page renders 200', async ({ request }) => {
  const r = await request.get('/');
  expect(r.status()).toBe(200);
});
