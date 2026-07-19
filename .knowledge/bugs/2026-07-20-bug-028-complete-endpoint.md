---
id: bug-2026-07-20-028
title: /api/interview/[id]/complete 缺失 + report 文案误导
category: bug
severity: high
tags: [interview, complete, report, scoring, message-route, idempotent]
created_at: 2026-07-20
project: interview-buddy

problem: |
  E2E agent #8 报告：用户点"完成"按钮后，report 页显示"加载失败"。
  根因：
  1. 前端 finish() 仅 router.push，没调任何 complete 端点
  2. 后端 message route 的 saveReport 路径需前端发 finish:true（但前端从不发）
  3. /api/interview/[id]/complete 端点根本不存在
  4. Report 表永远为空 → report 页 /api/interview/[id]/report 返回 404 → 显示"加载失败"
  5. 文案误导：404 应说"面试未完成"而非"加载失败"

root_cause: |
  前端/后端契约断裂：message route 设计了 `finish:true` 触发评分，但前端从不发。
  也无独立 complete 端点兜底。

solution: |
  1. 新建 POST /api/interview/[id]/complete 端点：
     - 鉴权 + 校验 userId
     - 幂等：已 COMPLETED 直接返回 reportId
     - update status=COMPLETED + endedAt + durationSec
     - 跑 scoreOne 并发评分 → aggregate → saveReport
     - 返回 reportId，前端跳 report 页立即拿到数据
     - maxDuration=60s（8 维度真实 LLM 约 30-50s）
     - 评分失败不影响 status 更新（用户可重试）

  2. 前端 finish() 改造：先 await /complete 再 router.push

  3. report 页文案分级：
     - 404 → "面试尚未完成，请先回到对话页点击'完成'按钮生成报告"
     - 403 → "无权查看该报告"
     - 其他 → d?.error?.message 或 "加载失败，请稍后重试"

verification:
  unit: vitest 126/126 passed
  type: tsc 0 errors
  e2e: 需 Phase 15+ 真实用户走完：开始 → 多轮对话 → 点完成 → 跳转报告页拿到数据

learned_from:
  - file: app/api/interview/[id]/complete/route.ts (new)
  - file: app/interview/[id]/page.tsx (finish 函数)
  - file: app/interview/[id]/report/page.tsx (文案分级)
  - file: app/api/interview/[id]/message/route.ts (原 finish:true 路径保留作历史)

prevention:
  - 任何"按钮触发副作用"必须显式调 API，不能依赖副作用传播
  - 后端 API 文案要分情况（404/403/500），不能统一 "加载失败"
  - 加幂等：同一 interview.complete() 调用多次结果一致（避免双击重复评分）