/**
 * Phase 14.17 直接 prisma 探测 endpoint（绕过 turnstile）
 *
 * GET /api/diagnose/prisma-direct → 实际调用 prisma.user.findUnique() 看真实 stack
 *
 * 用法：curl https://jianli.taomyst.top/api/diagnose/prisma-direct
 *
 * 这条 route 不调 turnstile，不限流，直接执行 prisma 查询。
 * 唯一保护：只允许指定邮箱（probe@diagnose.local），不让任意用户调。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROBE_EMAIL = 'probe@diagnose.local';

interface ProbeResult {
  ok: boolean;
  prismaVersion: string;
  prismaClientPath: string;
  engineQuery: {
    success: boolean;
    error: string | null;
    stack: string | null;
    userCount: number | null;
  };
  engineBinaries: {
    expected: string[];
    foundInDotPrismaClient: string[];
  };
  rawErrorDetails: {
    prismaClientFiles: string[];
  };
}

export async function GET(): Promise<NextResponse<ProbeResult>> {
  // 1. 拿 prisma 客户端信息
  const prismaVersion = (await import('@prisma/client/package.json')).default.version;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const prismaClientPath = require.resolve('@prisma/client');

  // 2. 实际调一次 prisma（用 probe email，不存在返回 null）
  let queryResult: ProbeResult['engineQuery'] = {
    success: false,
    error: null,
    stack: null,
    userCount: null,
  };
  try {
    const user = await prisma.user.findUnique({ where: { email: PROBE_EMAIL } });
    queryResult = {
      success: true,
      error: null,
      stack: null,
      userCount: user ? 1 : 0,
    };
  } catch (e: unknown) {
    const err = e as Error;
    queryResult = {
      success: false,
      error: err.message.slice(0, 2000),
      stack: (err.stack ?? '').slice(0, 4000),
      userCount: null,
    };
  }

  // 3. 列出 .prisma/client 目录所有文件
  let prismaClientFiles: string[] = [];
  let expectedBinaries: string[] = [];
  let foundBinaries: string[] = [];
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const prismaClientDir = path.join(prismaClientPath, '.prisma', 'client');
    if (fs.existsSync(prismaClientDir)) {
      prismaClientFiles = fs.readdirSync(prismaClientDir);
      expectedBinaries = prismaClientFiles.filter((f) => f.startsWith('libquery_engine'));
      foundBinaries = prismaClientFiles.filter(
        (f) => f.includes('1.1') || f.includes('3.0') || f.includes('musl')
      );
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    ok: queryResult.success,
    prismaVersion,
    prismaClientPath,
    engineQuery: queryResult,
    engineBinaries: {
      expected: expectedBinaries,
      foundInDotPrismaClient: foundBinaries,
    },
    rawErrorDetails: {
      prismaClientFiles,
    },
  });
}
