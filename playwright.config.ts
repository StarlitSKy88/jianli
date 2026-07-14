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
    },
  },
});
