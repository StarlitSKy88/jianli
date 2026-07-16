/**
 * Phase 14.14 诊断 endpoint — 一次性暴露 EdgeOne Pages runtime 真实环境
 *
 * GET /api/diagnose/prisma-runtime → JSON 包含：
 *   - process.platform / process.arch / process.version
 *   - /etc/os-release 内容（判定 ID=amzn vs ubuntu）
 *   - libssl 文件位置（probe 几个常见路径）
 *   - @prisma/client 路径 + .prisma/client 目录下的实际 binary 列表
 *   - 试图 init PrismaClient 看真实报错
 *
 * 用法：curl https://jianli.taomyst.top/api/diagnose/prisma-runtime
 */

import { NextResponse } from 'next/server';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { isTestHelpersEnabled, testHelperDisabledResponse } from '@/lib/test-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DiagnoseResult {
  node: {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
    pid: number;
  };
  osRelease: string | null;
  osReleaseParsed: Record<string, string>;
  libssl: {
    ldconfigOutput: string;
    foundFiles: string[];
  };
  prisma: {
    clientPackagePath: string | null;
    prismaClientPath: string | null;
    prismaClientDirFiles: string[];
    expectedBinaryNames: string[];
    initError: string | null;
    detectedPlatform: string | null;
  };
}

function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e: unknown) {
    return `__exec_error__: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function GET(): Promise<NextResponse<DiagnoseResult> | Response> {
  if (!isTestHelpersEnabled()) return testHelperDisabledResponse();

  // 1. Node 基本信息
  const node = {
    version: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  };

  // 2. /etc/os-release
  let osRelease: string | null = null;
  let osReleaseParsed: Record<string, string> = {};
  for (const path of ['/etc/os-release', '/etc/system-release', '/etc/lsb-release']) {
    try {
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf8');
        if (path.endsWith('os-release')) {
          osRelease = content;
          for (const line of content.split('\n')) {
            const m = /^([A-Z_]+)="?([^"\n]*)"?$/.exec(line.trim());
            if (m) osReleaseParsed[m[1]] = m[2];
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. libssl 文件位置
  const ldconfigOutput = safeExec(
    'ldconfig -p 2>/dev/null | grep -i ssl || echo "ldconfig_failed"'
  );
  const libsslSearchPaths = [
    '/lib64',
    '/usr/lib64',
    '/usr/lib/x86_64-linux-gnu',
    '/lib/x86_64-linux-gnu',
    '/usr/lib',
    '/lib',
  ];
  const foundFiles: string[] = [];
  for (const dir of libsslSearchPaths) {
    const out = safeExec(`ls ${dir}/libssl* 2>/dev/null || true`);
    if (out && !out.startsWith('__exec_error__') && out.trim()) {
      foundFiles.push(...out.trim().split('\n').filter(Boolean));
    }
  }

  // 4. prisma 客户端路径
  const clientPackagePath = require.resolve('@prisma/client/package.json');
  const prismaClientPath = require.resolve('@prisma/client');

  // 5. .prisma/client 目录下文件
  let prismaClientDirFiles: string[] = [];
  let expectedBinaryNames: string[] = [];
  try {
    const prismaClientDir = `${prismaClientPath}/.prisma/client`;
    if (existsSync(prismaClientDir)) {
      prismaClientDirFiles = readdirSync(prismaClientDir);
    }
    // 期望 binary 名
    expectedBinaryNames = prismaClientDirFiles.filter((f) => f.startsWith('libquery_engine'));
  } catch (e) {
    prismaClientDirFiles = [`__read_error__: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 6. 探测 prisma 实际期望哪个 binary
  let initError: string | null = null;
  let detectedPlatform: string | null = null;
  try {
    const { PrismaClient } = await import('@prisma/client');
    const p = new PrismaClient({ log: ['error'] });
    // 不实际 query，仅触发 engine 探测
    // @ts-expect-error 探测私有方法
    const detected = await p._engine?.getPlatform?.();
    detectedPlatform = detected || 'unknown';
    await p.$disconnect();
  } catch (e: unknown) {
    initError = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  }

  return NextResponse.json({
    node,
    osRelease,
    osReleaseParsed,
    libssl: {
      ldconfigOutput: ldconfigOutput.slice(0, 2000),
      foundFiles,
    },
    prisma: {
      clientPackagePath,
      prismaClientPath,
      prismaClientDirFiles,
      expectedBinaryNames,
      initError: initError ? initError.slice(0, 3000) : null,
      detectedPlatform,
    },
  });
}
