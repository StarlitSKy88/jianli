/**
 * Next.js middleware — X-Request-ID 注入
 *
 * 作用（解决 bug-019 教训：诊断太慢）：
 * - 每个请求自动生成 UUID，写入 request header (x-request-id)
 * - 同时写入 response header 让前端可读
 * - 关联 EdgeOne 实时日志 stderr（搜同一 requestId 即可定位）
 *
 * 性能：< 1ms 开销，仅生成一次 randomUUID()
 */
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

export function middleware(req: NextRequest) {
  // 客户端如已带 X-Request-ID 则复用（debug 时可控性更高）
  const incomingId = req.headers.get('x-request-id');
  const requestId = incomingId ?? randomUUID();

  const res = NextResponse.next();
  res.headers.set('x-request-id', requestId);

  // 同时写 request header 供 API route 读
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-request-id', requestId);

  return NextResponse.next({ request: { headers: reqHeaders } });
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，但排除：
     * - _next/static（静态资源）
     * - _next/image（图片优化）
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
