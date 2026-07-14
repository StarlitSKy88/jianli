/**
 * E2E Flow 1: 完整注册登录链路（真实验证码）
 *
 * 用 /api/_test/get-verify-code 钩子拿到验证码（仅 dev 启用）
 * 不依赖 UI 上的 dev hint 文字，避免与 console sender 改动耦合
 */
import { test, expect } from '@playwright/test';

const TEST_EMAIL = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@jianli.app`;
const TEST_PASSWORD = 'test123456';

test.describe('Flow 1: 完整注册登录链路', () => {
  test('API 路径：send → read code → register → login → /me', async ({ request }) => {
    // 1) 触发发码
    const sendR = await request.post('/api/auth/send-verify-code', { data: { email: TEST_EMAIL } });
    expect(sendR.status()).toBe(200);

    // 2) 拿码
    const codeR = await request.get(
      `/api/test-helper/get-verify-code?email=${encodeURIComponent(TEST_EMAIL)}`
    );
    expect(codeR.status()).toBe(200);
    const codeBody = await codeR.json();
    expect(codeBody.data?.code).toMatch(/^\d{6}$/);

    // 3) 注册
    const regR = await request.post('/api/auth/register', {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD, verifyCode: codeBody.data.code },
    });
    expect(regR.status()).toBe(201);

    // 4) 登录
    const loginR = await request.post('/api/auth/login', {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(loginR.status()).toBe(200);
    // 提取 cookie 头
    const cookies = loginR.headers()['set-cookie'];
    expect(cookies).toBeDefined();

    // 5) /me 验证（用 context 复用 cookie）
    const meR = await request.get('/api/auth/me', {
      headers: { cookie: (cookies as string).split(';')[0] },
    });
    expect(meR.status()).toBe(200);
    const meBody = await meR.json();
    expect(meBody.data?.email).toBe(TEST_EMAIL);
  });

  test('UI 路径：register page UI 触发 + 完整跳转', async ({ page }) => {
    const email = `e2e-ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@jianli.app`;

    await page.goto('/register');
    await page.fill('input[type=email]', email);

    // 触发发码 + 等真实响应（dev 冷启动可能 4+ 秒）
    const sendResp = page.waitForResponse(
      (r) => r.url().includes('/api/auth/send-verify-code') && r.request().method() === 'POST',
      { timeout: 30_000 }
    );
    await page.click('button[aria-label="发送验证码"]');
    const sendOk = await sendResp;
    expect(sendOk.status()).toBe(200);

    // 通过测试钩子拿码
    const code = await page.evaluate(async (e) => {
      const r = await fetch(`/api/test-helper/get-verify-code?email=${encodeURIComponent(e)}`);
      const d = await r.json();
      return d?.data?.code ?? null;
    }, email);
    expect(code).toMatch(/^\d{6}$/);

    // 填表 + 同意条款 + 提交
    await page.fill('input[placeholder*="验证码"]', code!);
    await page.fill('input[type=password]', TEST_PASSWORD);
    await page.check('input[type=checkbox]');
    await page.click('button[type=submit]');

    // 成功跳转 /interview/new
    await page.waitForURL(/\/interview\/new/, { timeout: 30_000 });

    // /me 验证
    const me = await page.evaluate(async () => {
      const r = await fetch('/api/auth/me');
      return await r.json();
    });
    expect(me.data?.email).toBe(email);
  });

  test('重发码触发 cooldown（按钮禁用 + 倒计时秒数）', async ({ page }) => {
    const email = `e2e-cd-${Date.now()}@jianli.app`;
    await page.goto('/register');
    await page.fill('input[type=email]', email);
    const sendResp = page.waitForResponse(
      (r) => r.url().includes('/api/auth/send-verify-code') && r.request().method() === 'POST',
      { timeout: 30_000 }
    );
    await page.click('button[aria-label="发送验证码"]');
    await sendResp;
    // 立即进入 cooldown
    await expect(page.locator('button[aria-label="发送验证码"]')).toBeDisabled({ timeout: 5_000 });
  });
});

test.describe('Flow 1.1: 错误处理', () => {
  test('login with wrong password → 401', async ({ request }) => {
    const r = await request.post('/api/auth/login', {
      data: { email: TEST_EMAIL, password: 'wrongpassword' },
    });
    expect(r.status()).toBe(401);
  });

  test('register with short password → 400', async ({ request }) => {
    const r = await request.post('/api/auth/register', {
      data: { email: `e2e-bad-${Date.now()}@jianli.app`, password: '123', verifyCode: '000000' },
    });
    expect(r.status()).toBe(400);
  });

  test('home page renders 200', async ({ request }) => {
    expect((await request.get('/')).status()).toBe(200);
  });

  test('register page renders 200', async ({ request }) => {
    expect((await request.get('/register')).status()).toBe(200);
  });

  test('login page renders 200', async ({ request }) => {
    expect((await request.get('/login')).status()).toBe(200);
  });
});
