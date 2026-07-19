---
id: bug-2026-07-20-025
title: 客户端缺 Content-Length 时 resume upload 撑爆 EdgeOne 128MiB
category: bug
severity: high
tags: [edgeone, serverless, upload, body-size, streaming, fail-closed]
created_at: 2026-07-20
project: interview-buddy

problem: |
  E2E agent #4 报告：用 chunked transfer encoding 或漏传 Content-Length 时，
  /api/resume/upload 早期 contentLength > 5MB 校验被绕过 → formData() 一路缓冲
  到 128MiB → EdgeOne Pages "package size exceeds 128MiB limit" 500。
  普通用户上传 5MB+1 byte 不会触发，但攻击者很容易构造 chunked 攻击。

root_cause: |
  `await req.formData()` 会把整个 body 读到内存解析 multipart，没有 streaming 大小限制。
  当客户端不传 Content-Length 时（chunked / curl --data-binary @file / 漏设 header），
  早期 contentLength 检查失效。

solution: |
  新增 `assertBodyWithinLimit(req, maxBytes)`：
  1. contentLength 声明 > maxBytes → 立即 413
  2. contentLength 缺失 → 用 req.body.getReader() 流式累加，超过 cancel + 413
  3. Next.js NextRequest.body 是底层 stream 的 tee 副本，getReader() 不消耗原 stream，
     后续仍可 await req.formData() 解析

  关键点：双保险，避免单条路径被绕过。

verification:
  unit: type-check 0 errors
  test: vitest 126/126 passed
  e2e: 需 Phase 15+ 真实大文件 + chunked 上传 E2E

learned_from:
  - file: app/api/resume/upload/route.ts

prevention:
  - 任何云函数 POST 路由，await req.formData() / req.json() / req.text() 前必须先限大小
  - 部署到 EdgeOne Pages 前必查 .knowledge/bugs/2026-07-16-bug-018-edgeone-pages-128mib-size-limit.md