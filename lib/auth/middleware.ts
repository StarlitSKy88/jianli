/**
 * 共享 API 工具：解析 session、错误响应
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, type SessionPayload } from './session';
import { randomUUID } from 'node:crypto';

export async function getSession(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get('token')?.value || extractBearerToken(req);
  if (!token) return null;
  return verifySession(token);
}

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

/**
 * 从 request header 读或生成新的 X-Request-ID
 * 用于跨 EdgeOne 实时日志/响应体关联排查
 */
export function getRequestId(req: NextRequest): string {
  return req.headers.get('x-request-id') ?? randomUUID();
}

export function errorResponse(code: string, message: string, status: number, req?: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message },
      ...(req ? { requestId: getRequestId(req) } : {}),
    },
    {
      status,
      headers: req ? { 'x-request-id': getRequestId(req) } : undefined,
    }
  );
}

export function successResponse<T>(data: T, status = 200, req?: NextRequest) {
  return NextResponse.json(
    { ok: true, data, ...(req ? { requestId: getRequestId(req) } : {}) },
    {
      status,
      headers: req ? { 'x-request-id': getRequestId(req) } : undefined,
    }
  );
}

export function validationErrorResponse(zodError: unknown, req?: NextRequest) {
  const err = zodError as { errors: Array<{ path: string[]; message: string }> };
  const requestId = req ? getRequestId(req) : undefined;
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      },
      ...(requestId ? { requestId } : {}),
    },
    {
      status: 400,
      headers: requestId ? { 'x-request-id': requestId } : undefined,
    }
  );
}
