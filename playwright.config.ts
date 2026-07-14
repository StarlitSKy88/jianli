import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // 串行：避免 DB 冲突
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  expect: { timeout: 10_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'PORT=3001 pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      NODE_ENV: 'development',
      // 继承调用进程的 DATABASE_URL（来自 .env.local，TiDB MySQL）
      DATABASE_URL: process.env.DATABASE_URL || '',
      // E2E 跳过 IP 限流（同 IP 多 test 共享 webServer）
      DISABLE_RATE_LIMIT: '1',
      // E2E 清空 Turnstile（让后端走 dev 无-secret 旁路，否则真校验拒绝假 token）
      TURNSTILE_SECRET_KEY: '',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
    },
  },
});
