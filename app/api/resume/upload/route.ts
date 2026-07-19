/**
 * POST /api/resume/upload
 * 入参：multipart/form-data，字段名 file
 * 流程：校验 → SHA256 hash → 检查去重 → 解析 → AI 提取 → 写 Resume
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import { getSession, errorResponse } from '@/lib/auth/middleware';
import { parseResume, ResumeParseError } from '@/lib/resume/parser';
import { extractStructured } from '@/lib/resume/ai-extract';
import { track } from '@/lib/analytics/track';

// EdgeOne Pages cloud-functions 单次内存 128MiB 硬上限。AI 提取 + 解析同时驻留，
// 单文件硬上限 5MB + 预留 8MB 给 AI/解析栈 ≈ 13MB，远低于 128MiB 阈值。
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Bug-025 (2026-07-20 E2E)：客户端用 chunked transfer encoding 不带 Content-Length，
 * 绕过早判 → formData() 一路缓冲到 128MiB → EdgeOne 500 "package size exceeds 128MiB"。
 *
 * 修复策略：双保险
 * (a) Content-Length > 5MB → 立即 413
 * (b) Content-Length 缺失 → 用 reader 累加，超过阈值 cancel + 413；不消耗原 body（Next.js
 *     NextRequest.body 是 tee 副本，getReader() 不会独占）
 */
async function assertBodyWithinLimit(req: NextRequest, maxBytes: number): Promise<void> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new HttpError(413, 'FILE_TOO_LARGE', '文件超过 5MB 限制');
  }
  if (declared > 0) return; // 有声明长度且合规，跳过 streaming 校验

  // 没有 Content-Length（chunked / 客户端漏传），流式累加 + 提前抛错
  if (!req.body) return;
  const reader = req.body.getReader();
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new HttpError(413, 'FILE_TOO_LARGE', '文件超过 5MB 限制');
    }
  }
  // Next.js NextRequest.body 是底层 stream 的 tee 副本，getReader() 不消耗原 stream，
  // 后续仍可 await req.formData() 解析。
}

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public override message: string
  ) {
    super(message);
  }
}
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  // Bug-025 (2026-07-20)：早期拒大文件 + 空 body + chunked 防御
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength === 0) return errorResponse('EMPTY_BODY', '请求体为空', 400);
  try {
    await assertBodyWithinLimit(req, MAX_FILE_SIZE);
  } catch (e) {
    if (e instanceof HttpError) {
      return errorResponse(e.code, e.message, e.status);
    }
    throw e;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse('INVALID_FORM_DATA', 'multipart 表单格式错误', 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return errorResponse('MISSING_FILE', '未找到文件', 400);
  if (file.size > MAX_FILE_SIZE) return errorResponse('FILE_TOO_LARGE', '文件超过 5MB 限制', 413);
  if (!ALLOWED_MIMES.has(file.type)) {
    return errorResponse('UNSUPPORTED_MIME', `不支持的文件类型: ${file.type}`, 415);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  // 去重：同 user 同 hash 已存在则直接返回
  const existing = await prisma.resume.findFirst({
    where: { userId: session.userId, fileHash },
    select: { id: true, name: true, yearsOfExperience: true, createdAt: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, resume: existing, deduplicated: true });
  }

  // 解析
  let parsed;
  try {
    parsed = await parseResume(buffer, file.type, file.name);
  } catch (e) {
    if (e instanceof ResumeParseError) {
      return errorResponse('PARSE_FAILED', e.message, 422);
    }
    console.warn(`[resume-upload] parse failed: ${(e as Error).message}`);
    return errorResponse('PARSE_FAILED', '简历解析失败', 500);
  }

  // AI 提取
  const extracted = await extractStructured(parsed.rawText);

  // 写库 — 安全：不返回解析后的明文 PII（email/phone 只用于 AI 推理，不回显）
  // 处理 dedup race condition：若 create 时命中 fileHash 全局唯一约束，按 fileHash 查重
  // Phase 13.8 修复 #134：之前按 (userId, fileHash) 复合查询，但 fileHash 是全局唯一
  // → 不同 user 上传相同文件时，B 用户的 race 恢复查询 miss，仍 500
  // → 正确做法：按 fileHash 全局查重（任意拥有者），dedup 后返回这条记录
  // 详见 .knowledge/bugs/2026-07-15-006-resume-dedup-prisma-p2002.yaml
  let resume;
  try {
    resume = await prisma.resume.create({
      data: {
        userId: session.userId,
        name: extracted.name || file.name,
        fileHash,
        fileUrl: null,
        rawText: parsed.rawText,
        parsed: extracted as object,
        currentCompany: extracted.projects[0]?.name || null,
        yearsOfExperience: extracted.yearsOfExperience,
        techStack: extracted.skills ?? ([] as string[]),
      },
      select: {
        id: true,
        name: true,
        yearsOfExperience: true,
        techStack: true,
        createdAt: true,
      },
    });
  } catch (e) {
    const prismaError = e as { code?: string };
    if (prismaError?.code === 'P2002') {
      // P2002 unique constraint on (userId, fileHash) — 同一 user 内的 race
      // 因为现在是 (userId, fileHash) 复合唯一，race 恢复按 userId + fileHash 复合查
      const existingAfterRace = await prisma.resume.findFirst({
        where: { userId: session.userId, fileHash },
        select: { id: true, name: true, yearsOfExperience: true, createdAt: true },
      });
      if (existingAfterRace) {
        return NextResponse.json({
          ok: true,
          resume: existingAfterRace,
          deduplicated: true,
        });
      }
    }
    throw e;
  }

  // 埋点：PRD § 9 简历解析成功
  track(session.userId, 'resume_uploaded', {
    resumeId: resume.id,
    yearsOfExperience: resume.yearsOfExperience ?? 0,
    techStackSize: Array.isArray(resume.techStack) ? resume.techStack.length : 0,
    mimeType: file.type,
    format: parsed.format,
  });

  return NextResponse.json({ ok: true, resume, format: parsed.format });
}
