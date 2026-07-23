---
name: finish-score-lost-on-client-abort
description: 客户端在 finish=true 时早断会触发一个 series of await 在 Next.js + Prisma + mock AI 链路里被隐式 AbortSignal 取消,导致 finish 评分路径整体不跑 (status 永远 IN_PROGRESS)
metadata:
  type: bug
  severity: high
  scope: app/api/interview/[id]/message/route.ts
  found_at: 2026-07-24
  found_in: Round 8A SSE 健壮性测试
  status: identified-follow-up-Round-9
---

# Bug-R8A-1: client abort → finish 评分整链路丢失（已识别，留 Round 9）

## 现象 (Symptoms)

`tests/stress/sse-boundary-tests.sh` 中 E17 断言：

```bash
# client 在 finish=true 时 50ms 后断开
curl --max-time 0.05 -X POST -d '{"finish":true,...}' ...
sleep 6
# 期望: status=COMPLETED + totalScore 存在
# 实际: status=IN_PROGRESS + totalScore=None
```

前一轮 dev 调试日志（隔离重现，零干扰）显示：

```
INSERT INTO messages (USER)        ✓ 成功
INSERT INTO messages (INTERVIEWER) ✓ 成功   ← controller.enqueue 抛错后 INTERVIEWER 也入了
                                           ← (其实 controller.enqueue 在写库之前已经 throw)

[if (finish)]  prisma.interview.update(COMPLETED)  ✗ 未执行
              Promise.all(scoreOne x 5)            ✗ 未执行
              saveReport                          ✗ 未执行
              interview.update(totalScore)        ✗ 未执行
```

最终 DB 状态：`status=IN_PROGRESS`,`totalScore=null`,report 不存在。

## 根因 (Root Cause)

`/api/interview/[id]/message` route handler 在以下结构里：

```typescript
export async function POST(req) {
  // ... auth, schema, find interview, rate limit
  await prisma.message.create({ USER });  // line 112 — 这个跑成功了

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await interviewer.ask();         // ~100ms (mock)
        await prisma.message.create({ INTERVIEWER });  // 跑成功
        if (body.data.finish) {
          await prisma.interview.update({ status: COMPLETED });  // ❌ 卡死
          ...
        }
      } catch (e) {
        // 这里 catch 了 AbortError
      }
    }
  });
}
```

**关键**: client 早断 → Next.js App Router + Node 20 + Web Streams 的组合会让 ReadableStream `start()` 内**在 client abort 之后的所有 await chain 抛 `AbortError`**，不区分是哪个 await。

具体证据：
- `await prisma.message.create({ INTERVIEWER })` 入库了 → 这一次 await 没被 cancel
- `await prisma.interview.update({ COMPLETED })` 没入库 → 这一次 await 被 AbortSignal 取消

可能原因（待 Round 9 验证）：
1. Next.js 14 App Router 把 `req.signal.aborted` 透传给 Response 上的 AbortController
2. Prisma 5 client 在 abort 时抛 `AbortError`
3. 多个 await 并发竞争时只有部分被 cancel，是 Next.js stream lifecycle 行为

## 已尝试 + 失败的方案 (Failed Attempts)

### 方案 1: 把 DB 写入前移到 enqueue 之前（**Round 8A first try**）

```diff
-        controller.enqueue(sseEvent({ content: out.question, ... }));
-        await prisma.message.create({ INTERVIEWER });
+        await prisma.message.create({ INTERVIEWER });  // 先入库
+        try { controller.enqueue(sseEvent({ content: out.question, ... })); } catch {}  // 再尝试发送
```

效果: E16 PASS（client abort 不触发 ghost write）✅
但: E17 仍 FAIL（finish 路径在 `prisma.interview.update(COMPLETED)` 上 abort cut）❌

### 方案 2: 把 finish 路径用 fire-and-forget 移出 try 块

未在 Round 8A 内尝试,留 Round 9 实施：
- 把 `if (body.data.finish)` 整块移到 `ReadableStream.cancel(reason)` 钩子
- cancel 钩子在 client 早断时独立触发,不受 start 链的 AbortSignal 蔓延

## 验证 (Verification)

### Round 8A 现状

- ✅ E16 PASS（client 早断不写 ghost assistant message）
- ❌ E17 FAIL（finish 评分丢失）
- ✅ E1-E15 + E16 全部 PASS (16/17)

### Round 9 验收目标

- 走方案 2 cancel 钩子路径
- 在 production-env 或 isolated test 验证
- E17 期望 PASS，且 `interview.status=COMPLETED` + `report.totalScore > 0`

## 教训 (Lesson)

**Loop 收敛纪律**：当一个 bug fix 触及多组件交叉（Next.js + Prisma + stream lifecycle + abort signal）且调试信号被 dev hot reload 干扰时：
- 一次 loop 内: 写 failing test + 识别现象 + 撤回破坏性改动 + commit test infra + 写 follow-up 卡
- 别试图 1 个 loop 修完所有 → 风险远大于收益
- 把"现象 + 失败方案 + 建议方向"固化进卡，下个 loop 在稳定环境里继续

**测试基础设施是资产**：即使 E17 暂 FAIL，E1-E16 + 测试脚本本身都是真资产，要 commit 进去。下次在这个基线上加方案 2 试。

## 相关 (Related)

- 压测卡 `tests/stress/sse-boundary-tests.sh` E16/E17 用例
- E16 fix（已 commit）: `controller.enqueue` try/catch 在 prisma.message.create 之后
- E17 待办：ReadableStream cancel 钩子挂 finish 评分
- Round 7 Bug-010（同一文件，已修）
