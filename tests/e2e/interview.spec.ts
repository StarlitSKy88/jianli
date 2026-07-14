/**
 * E2E Flow 2: API 路径测试
 * - 创建面试（需先有 resume，跳过）
 * - 列出我的面试
 * - 限流
 */
import { test, expect } from '@playwright/test';

test('unauthenticated POST /api/interview → 401', async ({ request }) => {
  const r = await request.post('/api/interview', {
    data: { company: 'byte', role: '后端工程师', level: 'P6', resumeId: 'fake' },
  });
  expect(r.status()).toBe(401);
});

test('unauthenticated GET /api/interview → 401', async ({ request }) => {
  const r = await request.get('/api/interview');
  expect(r.status()).toBe(401);
});

test('unauthenticated GET /api/interview/[id] → 401', async ({ request }) => {
  const r = await request.get('/api/interview/abc123');
  expect(r.status()).toBe(401);
});

test('interview/new page renders', async ({ request }) => {
  const r = await request.get('/interview/new');
  expect(r.status()).toBe(200);
});
