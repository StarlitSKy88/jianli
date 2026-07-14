/**
 * 共享 API 工具：解析 session、错误响应
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, type SessionPayload } from './session';

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

export function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function validationErrorResponse(zodError: unknown) {
  const err = zodError as { errors: Array<{ path: string[]; message: string }> };
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      },
    },
    { status: 400 }
  );
}
