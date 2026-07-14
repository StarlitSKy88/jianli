---
id: pattern-2026-07-14-002
title: API 中文化 envelope + SSE a11y + AbortController 三件套
category: pattern
severity: critical
tags: [i18n, sse, a11y, abortcontroller, error-envelope, react]
created_at: 2026-07-14
project: interview-buddy

problem: |
  Phase 8.2 P0 修复涉及 3 个并行的「前端体验」改造，单独看零散，组合在一起是固定模式：

  1. **14 处 API 错误裸英文** — `return NextResponse.json({error:'unauthorized'}, {status:401})`
     直接被前端 setError 展示给用户（英 → 中用户失联）。

  2. **SSE 流式聊天 4 处 a11y 缺陷** —
     - 流消息区无 `role="log" aria-live="polite"`，屏读用户感知不到 AI 输出
     - `fetch` 无 `AbortController`，组件 unmount 时 fetch 继续跑 → leak
     - reader 残 buf 未 flush，末尾 chunk 丢失
     - 心跳 `:keepalive` 行被当 content 解析崩溃

  3. **前端 setError 嵌套访问错误** — `setError(d.error)` 实际应为 `d.error?.message`，
     因 envelope 是 `{ok:false, error:{code, message}}` 嵌套。

solution: |
  **A. errorResponse 全局化（lib/auth/middleware.ts 已有）**

  ```ts
  // lib/auth/middleware.ts
  export function errorResponse(code: string, message: string, status: number) {
    return NextResponse.json({ ok: false, error: { code, message } }, { status });
  }

  export function successResponse<T>(data: T, status = 200) {
    return NextResponse.json({ ok: true, data }, { status });
  }

  export function validationErrorResponse(zodError: unknown) {
    const err = zodError as { errors: Array<{ path: string[]; message: string }> };
    return NextResponse.json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      },
    }, { status: 400 });
  }

  // 替换规则（14 处）
  return errorResponse('UNAUTHENTICATED', '未登录', 401);
  return errorResponse('FORBIDDEN', '无权访问他人面试', 403);
  return errorResponse('INTERVIEW_NOT_FOUND', '面试不存在', 404);
  return errorResponse('RESUME_NOT_FOUND', '简历不存在', 404);
  return errorResponse('INVALID_PROVIDER', `未知的 provider: ${params.id}`, 400);

  // 前端取 message（注意嵌套）
  const d = await r.json().catch(() => ({}));
  setError(d?.error?.message || '兜底中文文案');
  ```

  **B. SSE 流三件套（App Router + 流式响应）**

  服务端 (`app/api/interview/[id]/message/route.ts`)：
  ```ts
  // 1) SSE 心跳：每 15s 推 `:keepalive\n\n`，防 nginx/CDN 切断
  const heartbeat = setInterval(() => controller.enqueue(encoder.encode(':keepalive\n\n')), 15_000);
  // 2) x-accel-buffering: no 防 Nginx 缓冲
  res.headers.set('x-accel-buffering', 'no');
  ```

  客户端 (`app/interview/[id]/page.tsx`)：
  ```ts
  // 1) AbortController 持有 ref
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();  // unmount 清理
  }, []);

  async function send() {
    const ac = new AbortController();
    abortRef.current = ac;
    const r = await fetch(url, { ..., signal: ac.signal });
    const reader = r.body.getReader();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';  // 残 buf 留给下次
      for (const line of lines) {
        if (line.startsWith(':')) continue;  // 跳过 SSE 心跳
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        const parsed = JSON.parse(data);
        if (parsed.error) setError(parsed.error.message);
        else if (parsed.content) acc += parsed.content;
      }
    }
    // 流末尾 flush 残 buf（防御性）
    if (buf.trim() && buf.startsWith('data:') && buf.slice(5).trim() !== '[DONE]') {
      try { acc += JSON.parse(buf.slice(5).trim()).content; } catch {}
    }
  }
  ```

  **C. SSE 流消息区 a11y**

  ```tsx
  <div
    ref={scrollRef}
    role="log"
    aria-live="polite"       // 屏读：polite（不打断）
    aria-atomic="false"      // 只宣读新增
    aria-relevant="additions"
    aria-label="面试对话"
    className="overflow-y-auto"
  >
    {messages.map(m => ...)}
  </div>
  ```

  **D. 表单 input + 错误区 a11y**

  ```tsx
  <input
    type="email"
    aria-label="邮箱"
    aria-invalid={!!error}
    aria-describedby={error ? 'email-error' : undefined}
    className="input"
  />
  {error && (
    <p id="email-error" role="alert" className="text-red-500">
      {error}
    </p>
  )}
  ```

verification:
  unit: vitest 58/58（rate-limit-track.test 含 paid/fallback/track 三类）
  e2e: 13/13 + 1 skipped
  type-check: tsc --noEmit 0 errors
  build: pnpm build → 0 warnings / 0 errors
  smoke: curl 全 17 路由 200 + 6 项 API 错误全中文

learned_from:
  - task: Phase 8.2 P0 修复
  - files:
    - lib/auth/middleware.ts (errorResponse)
    - app/api/interview/[id]/message/route.ts (SSE heartbeat + x-accel-buffering)
    - app/interview/[id]/page.tsx (AbortController + role=log)
    - app/login/page.tsx (aria-label + d.error?.message)
    - app/register/page.tsx (aria-label + 同意 checkbox)

---

**Why**：
- envelope `{ok, error:{code, message}}` 同时支持前端 i18n 替换 + 后端结构化日志 + 多端一致
- SSE 心跳防 nginx/CDN/反代 60s 切断流；x-accel-buffering: no 关 Nginx 缓冲
- AbortController cleanup 防止组件 unmount 后 fetch 仍跑（内存 + 连接泄露）
- `role="log"` + `aria-live="polite"` 让屏读用户听到 AI 实时回答，是 WCAG 2.1 4.1.3 要求

**How to apply**：
- 任何 API 错误 → errorResponse(code, message, status) 三参数全局工具
- 任何 SSE / WebSocket → heartbeat + AbortController + 流末尾 flush + 心跳行 skip
- 任何 form input → aria-label + role=alert 错误 + aria-describedby 关联
- 任何前端取错误 → `d?.error?.message || 兜底`，永远不要 `d.error`（嵌套）