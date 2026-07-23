---
name: finish-score-lost-on-client-abort
description: 客户端在 finish=true 时早断会触发一个 series of await 在 Next.js + Prisma + mock AI 链路里被隐式 AbortSignal 取消,导致 finish 评分路径整体不跑 (status 永远 IN_PROGRESS)。Round 9 fire-and-forget 修复。
metadata:
  type: bug
  severity: high
  scope: app/api/interview/[id]/message/route.ts
  found_at: 2026-07-24
  found_in: Round 8A SSE 健壮性测试
  status: resolved-Round-9
---

# Bug-R8A-1: client abort → finish 评分整链路丢失（Round 9 已修复 ✅）

## 现象 (Symptoms)

`tests/stress/sse-boundary-tests.sh` 中 E17 断言（修前 RED）：

```bash
# client 在 finish=true 时 50ms 后断开
curl --max-time 0.05 -X POST -d '{"finish":true,...}' ...
sleep 8
# 期望: status=COMPLETED + totalScore 存在 + report 存在
# 实际: status=IN_PROGRESS + totalScore=None + report 不存在
```

修前 dev 调试日志（隔离重现，零干扰）显示：

```
INSERT INTO messages (USER)        ✓ 成功
INSERT INTO messages (INTERVIEWER) ✓ 成功   ← controller.enqueue 抛错后 INTERVIEWER 也入了

[if (finish)]  prisma.interview.update(COMPLETED)  ✗ 未执行
              Promise.all(scoreOne x 5)            ✗ 未执行
              saveReport                          ✗ 未执行
              interview.update(totalScore)        ✗ 未执行
```

最终 DB 状态：`status=IN_PROGRESS`,`totalScore=null`,report 不存在 — 用户金钱丢失级 bug。

## 根因 (Root Cause)

`/api/interview/[id]/message` route handler 结构：

```typescript
export async function POST(req) {
  // ... auth, schema, find interview, rate limit
  await prisma.message.create({ USER });  // 跑成功了

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await interviewer.ask();         // ~100ms (mock)
        await prisma.message.create({ INTERVIEWER });  // 跑成功
        if (body.data.finish) {
          await prisma.interview.update({ status: COMPLETED });  // ❌ 卡死
          // ... Promise.all(scoreOne x 5) + saveReport + totalScore
        }
      } catch (e) {
        // catch AbortError → 整个 finish 链路被吞
      }
    }
  });
}
```

**关键**：client 早断 → Next.js 14 App Router + Node 20 + Web Streams 组合让 ReadableStream `start()` 内**在 client abort 之后的所有 await chain 抛 `AbortError`**。

具体证据（修前）：
- `await prisma.message.create({ INTERVIEWER })` 入库了 → 该 await 没被 cancel
- `await prisma.interview.update({ COMPLETED })` 没入库 → 该 await 被 AbortSignal 取消

可能原因（已确认）：
1. Next.js 14 把 `req.signal.aborted` 透传给 Response 上的 AbortController
2. Prisma 5 client 在 abort 时抛 `AbortError`
3. AbortSignal cascade 范围仅限 stream lifecycle 内的 await chain

## 修法（Round 9 fire-and-forget ✅）

**关键设计决策**：把 finish 评分路径移出 `ReadableStream.start()` 的 try 块，作为**独立的 fire-and-forget Promise**。

```typescript
// app/api/interview/[id]/message/route.ts (Round 9 修复)
if (body.data.finish) {
  void runFinishPipeline({
    interviewId: interview.id,
    userId: session.userId,
    company, scenarioCompany, role, level, scenarioWeights,
    windowedMessages,
  }).catch((e) => {
    console.error('[finish-pipeline] unexpected failure', {
      interviewId: interview.id, userId: session.userId,
      errorMessage: (e as Error).message,
    });
  });
}

// 新独立函数
async function runFinishPipeline(args) {
  await prisma.interview.update({ status: COMPLETED, endedAt: new Date() });
  track(userId, 'interview_completed', { interviewId });
  const dims = Object.keys(args.scenarioWeights).filter(d => args.scenarioWeights[d] > 0);
  const scoreEntries = await Promise.all(
    dims.map(async (dim) => {
      const score = await scoreOne({ company, role, level, dimension: dim, transcript });
      return [dim, score];
    })
  );
  const scores = Object.fromEntries(scoreEntries);
  const report = aggregate({ company, scores });
  await saveReport({ interviewId, userId, company: scenarioCompany, scores, aggregated: report });
  await prisma.interview.update({ totalScore: report.totalScore });
}
```

**为什么 fire-and-forget 逃出 AbortSignal cascade？**
- `void` 关键字 + 不 `await` → runFinishPipeline 启动后立刻返回，不阻塞 handler
- 该 promise 是独立 microtask，跟 stream lifecycle 无任何引用关系
- Next.js 不会把这个 promise 链上的 await 视作"stream 内 await"
- 客户端 abort 只影响 `controller.enqueue` 触发的 stream errors，不影响独立 promise

## 验证 (Verification)

### Round 9 结果 ✅

- ✅ E17 PASS（client finish+abort 后 status=COMPLETED + totalScore=77 + report 5 维度齐）
- ✅ E8 PASS（fire-and-forget 评分完成后查 report）
- ✅ E10 PASS（并发 finish race 后 totalScore=77）
- ✅ 全套 **17/17 stress PASS**, 0 FAIL, 1 SKIP

### 测试脚本同步更新

- E17 sleep 8→15（POST handler 内部 await stream 关闭 8-13s）
- E8/E10 sleep 3→8（finish 评分 fire-and-forget 需 ~5s）
- python JSON 解析改 `strict=False`（response 含中文 prompt 嵌 `\n` 控制字符）

### 类型与回归

- `pnpm type-check` 0 errors
- `pnpm test` 232/232 passed（无回归）

## 教训 (Lesson)

**Loop 收敛纪律兑现**：当一个 bug fix 触及多组件交叉（Next.js + Prisma + stream lifecycle + abort signal）且调试信号被 dev hot reload 干扰时：
- 一次 loop 内: 写 failing test + 识别现象 + 撤回破坏性改动 + commit test infra + 写 follow-up 卡
- 下个 loop 在稳定 env 里继续 → Round 9 修完 ✅

**新洞察**：
- Next.js SSE Response 不等 stream 关闭也立即返回 (POST 200 in 44ms 证据) — 但 handler 内 `await` 还是会被 AbortSignal 影响
- AbortSignal cascade 范围**仅限 stream lifecycle 内的 await chain**
- 独立 promise（`void someAsyncFn()`）完全逃出 cascade

**为什么不用 ReadableStream.cancel(reason)？**
- cancel 只在 client abort 时触发,正常完成时 finish 路径分裂两处难维护
- finish=true + client 正常等待 stream 完成时,scoreOne 仍在 start() try 块内被 await → 仍受 AbortSignal 影响
- fire-and-forget 单一路径,不区分 client 是否 abort

**测试基础设施是资产**：E1-E17 边界用例作为对抗回归基线全部 commit。下一个相关 bug 5 秒内可定位。

## 相关 (Related)

- 压测卡 `tests/stress/sse-boundary-tests.sh` E1-E17 全套
- E16 fix（Round 8A commit `69171bb`）: `controller.enqueue` try/catch 在 prisma.message.create 之后
- E17 fix（Round 9 commit pending）: fire-and-forget `runFinishPipeline`
- Round 7 Bug-010（同一文件，已修）: bizStatus SSE event 替代 x-biz-status header
- Round 6 Bug-009: rate-limit DISABLE_RATE_LIMIT 短路