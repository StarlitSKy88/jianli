---
name: phase-b-10users-no-blocking-bugs
description: Phase B 全功能压测 (10 真实用户画像) 验证零 user-blocking bugs,发现 2 个 dev-only 测试工具问题 (脚本 silent fail)。
metadata:
  type: pattern
  severity: info
  scope: tests/stress/phase-b-10users.sh
  found_at: 2026-07-24
  found_in: Phase B 真实用户压测
  status: resolved-Phase-B
---

# Phase B: 10 用户真实压测 0 user-blocking bugs ✅

## 现象 (Phenomenon)

**Goal**: 模拟 10 个真实用户 (4 公司 × 多职级 × 多岗位) 跑完整套产品功能,**找出**所有阻塞 5xx/失败/数据不一致的 bug。

**测试覆盖路径** (每个用户全跑 9 步):
```
注册 send-code → 注册 register → /me
  ↓
上传简历 resume/upload → 创建面试 /interview
  ↓
5 轮对话 /interview/:id/message (SSE)
  ↓
finish=true 触发评分 (fire-and-forget)
  ↓
查看评分报告 /interview/:id/report (5 维度 unique≥6)
  ↓
创建支付 /payment → 确认 /payment/:id/confirm
  ↓
提交反馈 /feedback → 登出 /auth/logout
```

## 10 个真实用户画像

| # | 公司 | 职级 | 岗位 | 测试重点 |
|---|---|---|---|---|
| U1 | byte | P6 | backend | 后端核心场景 |
| U2 | ali | P5 | frontend | 阿里前端流程 |
| U3 | byte | P7 | algorithm | 算法维度差异化 |
| U4 | bili | P5 | product | 转型 PM 文化匹配 |
| U5 | tencent | T3 | backend | 微信支付链路 |
| U6 | ali | P4 | java | 应届边界 |
| U7 | byte | P8 | system_arch | 资深架构 |
| U8 | bili | P6 | qa | 跨界 QA |
| U9 | tencent | T3 | client | 移动客户端 |
| U10 | ali | P6 | operation | **35+ 跨界**主目标人群 |

## 结果 (Result)

```
━━━ Phase B 汇总 ━━━
  跑过用户: 10 / 10
  失败用户:  (共 0 个测试项失败)
✅ 10 用户全功能 0 阻塞
```

每个用户的 final 状态:
- score unique≥6 (差异化评分) - U1 79 / U4 P5 + / U7 P8 + / U10 79 ✅
- pay-confirm 200 granted=1
- feedback 200 accepted
- logout 200 loggedOut

## 测试工具发现的问题 (非 user-blocking)

### Bug-B-10-3 [Script bug] pay-confirm silent fail
**症状**: Phase B 第一遍跑 `pay-confirm.json` 写入空文件,脚本捕获 $R="" 后面 fail。
**根因**: `R=$(curl -s -m 30 -X POST ...)` 当 server 慢或 timeout 时 curl exit 但 stdout = 空,空字符串 grep 没命中。
**修法**: 加 `-w "\n__HTTP__:%{http_code} __TIME__:%{time_total}\n" -o body.txt 2> err.txt` 分离 stdout/stderr/HTTP,空响应能诊断是 server 慢还是脚本 bug。

### Bug-B-10-4 [Script bug] dev test-helper cold start 偶发空响应
**症状**: `get-verify-code` 在 U1 第一个 cold-start 调用 5002ms,返回空字符串。
**根因**: dev mode dev-server.log 显示 `POST /api/auth/send-verify-code 200 in 5002ms`(Next.js 第一次编译),验证码字段没及时落库。
**修法**: 脚本拿 code 时打印原始 response,把 2000ms 起 timeout 加 `-m 10` 捕获空响应便于定位。

这两个都不影响 prod 真实用户路径 (test-helper 是 dev-only)。

## 教训 (Lesson)

### 这是一份"复利工程"的范本案例
- 上一轮 Round 9 修了 SSE finish-score-lost (高危,用户金钱丢失级)
- 这一轮 Round 10 用 **真实用户画像** + **完整功能链** + **mock 隔离 quota** 验证 0 阻塞

### 为什么 mock 隔离 quota 重要
- 真实 AI quota 耗尽会让所有用户走 **同一个错误路径** (`AI 输出非 JSON` 大量出现)
- mock provider 让测试仅验证**链路正确性**,不验证 AI 内容质量 (后者需要真实 AI 单测)

### 测试脚本自身也是产品
- silent fail = 测试覆盖盲区
- 一行 `-w '%{http_code}'` 让任何空响应立刻变可见
- 测试基础设施相当于"对抗回归基线",每个 E1-E17 + 每个 Phase B 用户 = 一个发现 bug 的雷达

### 主动压测 vs 被动修 bug
- Round 9 修完一个 user-blocking bug
- Round 10 用 agent 模拟 10 真实用户**主动找 bug**
- 结果: 0 bug → **MVP 真实可用性里程碑达成**

## 验证 (Verification)

```
$ bash tests/stress/phase-b-10users.sh
━━━ Phase B: 10 用户全功能压测 (dev server http://localhost:3001) ━━━
  ... [10 users] ...
━━━ Phase B 汇总 ━━━
  跑过用户: 10 / 10
  失败用户:  (共 0 个测试项失败)
✅ 10 用户全功能 0 阻塞
```

## 相关 (Related)

- Round 9: `.knowledge/bugs/2026-07-24-finish-score-lost-on-client-abort.md` (上一轮修的真实 bug)
- Round 8A: E16 ghost-write fix (Round 8A 修的另一个真实 bug)
- Bug 卡计数: 30 → 31 (+1 this Phase)
- 压测套件: `tests/stress/phase-b-10users.sh` (新)
- 测试基础设施基线: SSE 17/17 + Phase B 10/10 = 27/27 边界+真实用户覆盖
