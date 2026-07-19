/**
 * /api/resume 路由单元测试 — B12 修复固化
 *
 * 关键行为契约：
 * 1. 未登录 → 401 + UNAUTHENTICATED
 * 2. 登录用户 → 200 + 每条简历包含 id/name/yearsOfExperience/techStack/parsed/createdAt
 * 3. 防御性 normalize: parsed 为 null/undefined/数组时统一返回 {} (避免前端 r.parsed?.skills?.join() crash)
 * 4. 防御性 normalize: techStack 为非数组时统一返回 []
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockResumeFindMany } = vi.hoisted(() => ({
  mockResumeFindMany: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    resume: {
      findMany: mockResumeFindMany,
    },
  },
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
  NextRequest: class {},
}));

// Mock auth middleware: getSession 返回受控 session
const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  getSession: mockGetSession,
  successResponse: (data: unknown) => ({ body: { ok: true, data }, status: 200 }),
  errorResponse: (code: string, msg: string, status: number) => ({
    body: { ok: false, error: code, message: msg },
    status,
  }),
}));

import { GET } from '@/app/api/resume/route';
import { NextRequest } from 'next/server';

function makeReq() {
  // NextRequest 在测试中用最小占位符即可（auth middleware 已 mock）
  return { headers: new Headers() } as unknown as NextRequest;
}

describe('/api/resume — B12 修复固化', () => {
  beforeEach(() => {
    mockResumeFindMany.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      userId: 'user-1',
      email: '20925250@qq.com',
    });
  });

  it('场景 1：未登录 → 401 + UNAUTHENTICATED', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = (await GET(makeReq())) as unknown as {
      body: { ok: boolean; error?: string };
      status: number;
    };
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('场景 2：登录用户 → 200 + 每条简历包含完整 schema', async () => {
    mockResumeFindMany.mockResolvedValueOnce([
      {
        id: 'r1',
        name: '张三',
        yearsOfExperience: 6,
        techStack: ['React', 'Next.js'],
        parsed: { skills: ['React', 'Next.js'], yearsOfExperience: 6 },
        createdAt: new Date('2026-07-19T10:00:00Z'),
      },
    ]);

    const res = (await GET(makeReq())) as unknown as {
      body: { ok: boolean; data: { resumes: Array<Record<string, unknown>> } };
      status: number;
    };
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const list = res.body.data.resumes;
    expect(list).toHaveLength(1);
    const r = list[0];
    // 关键: 必须返回这些字段，前端 page.tsx 才能正确渲染
    expect(r.id).toBe('r1');
    expect(r.name).toBe('张三');
    expect(r.yearsOfExperience).toBe(6);
    expect(r.techStack).toEqual(['React', 'Next.js']);
    expect(r.parsed).toBeTypeOf('object');
  });

  it('场景 3a：防御性 normalize — parsed=null → {}', async () => {
    // 模拟历史脏数据: AI 提取失败时 parsed 字段被存为 null
    mockResumeFindMany.mockResolvedValueOnce([
      {
        id: 'r1',
        name: 'test',
        yearsOfExperience: 0,
        techStack: [],
        parsed: null,
        createdAt: new Date(),
      },
    ]);

    const res = (await GET(makeReq())) as unknown as {
      body: { data: { resumes: Array<{ parsed: unknown }> } };
    };
    expect(res.body.data.resumes[0].parsed).toEqual({});
  });

  it('场景 3b：防御性 normalize — parsed 是数组（脏数据）→ {}', async () => {
    // 数据库 schema 错乱或人为污染（parsed 应该是 object，脏数据时是数组）
    mockResumeFindMany.mockResolvedValueOnce([
      {
        id: 'r1',
        name: 'test',
        yearsOfExperience: 0,
        techStack: [],
        parsed: ['weird', 'array'] as unknown as Record<string, unknown>,
        createdAt: new Date(),
      },
    ]);

    const res = (await GET(makeReq())) as unknown as {
      body: { data: { resumes: Array<{ parsed: unknown }> } };
    };
    expect(res.body.data.resumes[0].parsed).toEqual({});
  });

  it('场景 4：防御性 normalize — techStack 非数组 → []', async () => {
    mockResumeFindMany.mockResolvedValueOnce([
      {
        id: 'r1',
        name: 'test',
        yearsOfExperience: 0,
        techStack: null as unknown as string[],
        parsed: {},
        createdAt: new Date(),
      },
    ]);

    const res = (await GET(makeReq())) as unknown as {
      body: { data: { resumes: Array<{ techStack: string[] }> } };
    };
    expect(res.body.data.resumes[0].techStack).toEqual([]);
  });

  it('场景 5：多条简历按 createdAt desc 排序被遵守', async () => {
    mockResumeFindMany.mockResolvedValueOnce([]);

    await GET(makeReq());
    expect(mockResumeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    );
  });
});
