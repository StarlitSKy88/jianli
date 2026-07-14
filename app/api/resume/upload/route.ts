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

const MAX_FILE_SIZE = 5 * 1024 * 1024;
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

  // 早期拒大文件 + 空 body（防内存占用）
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength === 0) return errorResponse('EMPTY_BODY', '请求体为空', 400);
  if (contentLength > MAX_FILE_SIZE) {
    return errorResponse('FILE_TOO_LARGE', '文件超过 5MB 限制', 413);
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
  const resume = await prisma.resume.create({
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
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, resume, format: parsed.format });
}
