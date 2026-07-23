---
name: x-biz-status-never-updates
description: SSE 流式响应中的 x-biz-status HTTP header 一旦发出就不可变(P0-3 修复半成品),永远停留在 'pending'。改在 SSE event 里携带 {bizStatus: success/error}
metadata:
  type: bug
  severity: medium
  scope: app/api/interview/[id]/message/route.ts
  found_at: 2026-07-23
  found_in: Round 6 收尾, Round 7 修复
  status: fixed
---

# Bug-010: x-biz-status header 永远 pending（P0-3 半成品）

## 现象 (Symptoms)

P0-3 修复（2026-07-15）时希望在 SSE 流响应里通过 `x-biz-status` HTTP header 区分：

- `pending` — 流进行中
- `success` — 业务成功（评分入库）
- `error` — 业务失败（AI 抛错、限流、配额耗尽等）

实际跑测试发现 header **永远**是 `pending`：

```bash
$ curl -i .../api/interview/$IV/message -d '{"finish":true,...}' | grep x-biz
x-biz-status: pending
# 即使流已经返回 [DONE] 加上 totalScore=77,header 仍然是 pending
```

监控/告警如果基于 `x-biz-status != pending` 聚合"业务成功率"，会得到 0%，失去告警意义。

## 根因 (Root Cause)

HTTP/1.1 §7 协议层硬约束：

```
Response.headers 一旦通过 Response object 构造时序列化进 HTTP start line,
后续无法修改。SSE 是单向流,流期间/之后都没有 trailer header 写入能力。
```

Vercel Edge Runtime / Node http 模块都不暴露 `response.addTrailers()` API。
Web Streams API 的 `Response(ReadableStream, { headers })` 同样：headers 在 init 时定型，永远不能改。

P0-3 当年只看到「能加一个 header 了」，没追问「能不能更新它」，埋下了这颗雷。

## 修复 (Fix)

**策略变更**：从 HTTP header 层迁移到 SSE event 层。

```typescript
// route.ts 新增 helper (Round 7 Bug-010 修复)
function sseBizStatus(status: 'success' | 'error'): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ bizStatus: status })}\n\n`);
}

// 成功路径
controller.enqueue(sseBizStatus('success'));
controller.enqueue(sseDone());

// 错误路径
controller.enqueue(sseEvent({ error: { code: 'STREAM_ERROR', message: ... } }));
controller.enqueue(sseBizStatus('error'));
controller.enqueue(sseDone());

// Response headers 删除 'x-biz-status': 'pending'
```

前端用法：

```typescript
const source = new EventSource(...);
source.addEventListener('message', (e) => {
  const data = JSON.parse(e.data);
  if (data.bizStatus === 'success') {
    // 业务成功,关闭流
  } else if (data.bizStatus === 'error') {
    // 业务失败,显示 STREAM_ERROR
  } else if (data.content) {
    // AI 正在输出内容
  }
});
```

## 验证 (Verification)

### Failing test (钉死现状)

`tests/stress/sse-boundary-tests.sh` E13/E14/E15：

- **E13**: 业务流应含 `data: {"bizStatus":"success"}`
- **E14**: finish=true 流应含 `data: {"bizStatus":"success"}`（评分入库即业务成功）
- **E15**: 不应再返回 `x-biz-status` header

修复前 E13/E14 都 FAIL（curl SSE body 里没有 bizStatus 事件），证明假设正确。

修复后 15/15 PASS：12 个老边界用例 + 3 个新业务状态用例。

### 回归

- Round 6 12 个用例（鉴权 401/404/403、空 messages 400、content>2000 400、COMPLETED 400、SSE 业务成功、finish 评分、并发 finish race、abort、JSON 注入）全 PASS
- type-check 干净
- vitest 232/232 不变（SSE 是 network 边界，单测层面无新加）

## 教训 (Lesson)

**协议层不确定时先停手**：HTTP header 是否可更新、trailer 是否被 runtime 支持、stream 是否能关闭后修改响应... 这些都是协议/平台层约束，不是"我加一行代码"能解决的。下次看到 `headers: { ... }` 时多问一句："这之后还能改吗？"

**业务状态首选应用层标记**：HTTP header 适合"传输元数据"（content-type、cache-control），**业务状态（成功/失败）放在 response body 里**（无论是 SSE event、JSON envelope 还是 trailer）才是正解。监控/告警读 body 比读 header 灵活一万倍。

**Half-fix 不要漏 patch**：P0-3 当年加了 header 但没追"能不能更新它"，相当于打了个 0 的洞。这次发现 / 修复两个 round 才闭环，正是因为之前没做完。

## 相关 (Related)

- Bug 卡 `.knowledge/bugs/2026-07-23-checklimit-disableratelimit-not-read.md` (Round 6 同 loop)
- 反模式卡 `.knowledge/patterns/2026-07-23-debug-toggle-mirroring.md`
- 压测卡 `tests/stress/sse-boundary-tests.sh` E13/E14/E15 用例
- Phase 14 changelog: 2026-07-15 P0-3 origin, 2026-07-23 Round 7 Bug-010 close
