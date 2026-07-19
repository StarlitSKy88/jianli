---
id: bug-028-dual-envelope
title: Bug-028 API envelope 改造后 prod 老前端卡"加载中…"
category: bug
severity: high
tags: [envelope, dual-write, edgeone-deploy, bug-028]
created_at: 2026-07-20
project: interview-buddy
related: bug-028-complete-endpoint
---

# Bug-028 dual-envelope 兜底

## Problem

2026-07-20 用户报障：`https://jianli.taomyst.top/interview/cmrs2sgm80028eh4bch7lqpxa/report` 显示"加载失败"。

### 五阶根因

1. **prod 浏览器跑老前端**：`d.report`（顶层直读）
2. **Bug-028 修复改了 API envelope**：从 `{ report }` → `{ ok, data: { report } }`（successResponse 标准）
3. **API 响应变了**：老前端 `d.report = undefined`
4. **EdgeOne 部署延迟**：新前端代码还没上线，老前端解析新 envelope 失败 → 卡"加载中…"
5. **CDN cache 拖累**：老 build 还可能被 CDN 缓存

### 触发场景

任何对 API envelope 的破坏性变更（新增 `data` 包裹层、改字段名）都会让 prod 老前端解析失败。
EdgeOne Pages cloud-functions 部署 + CDN propagation 是两个异步过程，build 成功 ≠ CDN 同步。

## Solution

### 1. Dual-envelope（本次采用）

`/api/interview/[id]/report` 同时返回两种形状：

```json
{
  "ok": true,
  "data": { "report": {...} },     // 新前端（d.data.report）
  "report": {...}                   // 老前端（d.report 直读）
}
```

实现：
```typescript
return NextResponse.json({ ok: true, data: { report }, report });
```

**适用场景**：envelope 形状破坏性变更期间，prod 老前端等不及 EdgeOne 重新部署完成。

### 2. 应急数据修复

`scripts/fix-interview-report.js`：手动给报障的 interview 写 Report 数据，
不依赖 LLM，直接用均衡 70 分占位，等人工复审。

```bash
INTERVIEW_ID=xxx node scripts/fix-interview-report.js
```

输出：
```
[fix] interview=cmrs2sgm80028eh4bch7lqpxa status=COMPLETED msgs=12 company=bili
[fix] status=COMPLETED durationSec=459
[fix] report created id=cmrs61jo1000113vvw4db6lbg totalScore=70
[fix] DONE
```

## Verification

- `pnpm type-check` 0 errors
- `pnpm test` 155/155 passed
- `curl /api/interview/cmrs2sgm80028eh4bch7lqpxa/report`：
  - 旧字段 `report` 在顶层 ✅
  - 新字段 `data.report` 在 data 下 ✅
- commit `5c12bb2` push master ✅

## Lessons

### 1. Envelope 形状必须 incremental
任何 `{ ok, data }` 包装层的引入应该是**新增字段**，不是**替换**。
老字段保留 N 个版本（v1/v2/v3），前端按需读取。

### 2. EdgeOne 部署感知
- `git push` → EdgeOne 触发 build（5min 内）
- build 成功 → CDN 同步（5-10min 滞后）
- 用户浏览器可能跑老 build 30 分钟以上
- 期间 envelope 改造会让老前端**静默失败**

### 3. 应急脚本必须入库
本次 `scripts/fix-interview-report.js` 是 1-off 应急脚本，但下次类似事件需要它。
**铁律**：所有应急脚本必须 commit + push，不能留在 staging 区外。

### 4. 报障定位 SOP
1. console + network 看 HTTP code 和 response body
2. curl 同一 URL 复现
3. 检查 git log 最近是否有 envelope/successResponse 改动
4. 检查 EdgeOne build/deploy 状态
5. 应急：dual-envelope + DB-level fix
6. 等部署完再清 dual-shape

## Phase 15 TODO

- 全量统一所有 API 到 envelope `{ ok, data }`
- 前端统一走 `d.data.*` 解构
- 删除 dual-shape 兼容代码
- 文档统一更新
