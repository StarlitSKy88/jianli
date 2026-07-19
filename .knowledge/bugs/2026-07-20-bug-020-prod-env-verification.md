# Bug-020: prod 环境真实生效验证 SOP（OpenRouter API_KEY）

**日期**: 2026-07-20
**严重度**: medium（不是 bug，是验证 SOP；不固化下次还会踩坑）
**项目**: interview-buddy
**前置卡片**: bug-018 (EdgeOne 128MiB) — 告诉我们"build ✅ 不代表部署 ✅"

## 现象（用户感知最糟）

prod 上线前最后一道关卡：怎么证明 **`OPENROUTER_API_KEY` 真在 EdgeOne runtime** 生效？

❌ **不可信信号**：
- EdgeOne 控制台显示「构建状态 ✅ 成功」
- `pnpm build` 在本地通过
- EdgeOne 控制台 env 列表里能看到 `OPENROUTER_API_KEY=sk-or-v1-***`

✅ **可信信号**（4 阶证据链）：

### 阶段 1：health 检查（基本盘）

```bash
curl -s https://jianli.taomyst.top/api/health | python3 -m json.tool
# 期望: {"ok": true, "db": "up", "ai": {"enabled": ["openrouter"], "mockEnabled": false}}
```

**通过条件**：
- `ai.enabled` 含 `"openrouter"`（ai-router 注册到 provider 列表）
- `ai.mockEnabled: false`（mock 已关闭，否则会走到 mock 而非真实 provider）
- `db: "up"`（顺便确认 TiDB 连得通）

### 阶段 2：env 诊断（key 是否真注入 runtime）

```bash
curl -s https://jianli.taomyst.top/api/test-helper/diagnose-env
# ⚠️ 必须先 ENABLE_TEST_HELPERS=1，且 prod 默认 404
```

**4 种结果对应不同处理**：

| `OPENROUTER_API_KEY` 字段 | 含义 | 处理 |
|---|---|---|
| `present: true, prefix: "sk-or-v1-"` | ✅ env 生效 | 继续阶段 3 |
| `present: false` | ❌ env 未传到 runtime | 检查 EdgeOne「运行时可见」是否勾选 |
| `present: true, looksLikePlaceholder: true` | ⚠️ 是模板字符串 | 让昴君重贴真 key |
| 404 (helper disabled) | ⚠️ helper 已关 | 走"业务级验证"路径（阶段 3） |

### 阶段 3：业务级验证（真 AI 提取数据）

```bash
# 1. 登录拿 token
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"email":"20925250@qq.com","password":"Hello2026!"}' \
  https://jianli.taomyst.top/api/auth/login | jq -r '.set-cookie')

# 2. 上传简历触发 AI
curl -s -H "Cookie: token=$TOKEN" -F "file=@/tmp/test-resume.txt" \
  https://jianli.taomyst.top/api/resume/upload | jq

# 期望: parsed.yearsOfExperience > 0 + parsed.techStack.length > 0
# （mock 会返回空，因为 mock 不调 AI 提取）
```

### 阶段 4：真 AI 对话（SSE 流）

```bash
# 创建面试 + 发消息
INTERVIEW_ID=$(curl -s -X POST -H "Cookie: token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"company":"byte","role":"后端工程师","level":"P7","resumeId":"..."}' \
  https://jianli.taomyst.top/api/interview | jq -r .data.id)

curl -s -X POST -H "Cookie: token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"我做了 5 年后端"}],"finish":false}' \
  https://jianli.taomyst.top/api/interview/$INTERVIEW_ID/message
# 期望: SSE 流返回真实 AI 提问（非 mock 默认文本）+ 延迟 > 5s
```

### 阶段 5：调试完关 test-helper（铁律）

```bash
# 验证完立刻关，避免长期暴露给 prod 流量
# EdgeOne 控制台 → 环境变量 → 删除 ENABLE_TEST_HELPERS=1
```

## 真凶（学到的最大教训）

### 教训 1：build ✅ ≠ 部署 ✅
- 本地 `pnpm build` 通过，但 EdgeOne Pages 制品可能因 128MiB 限制**根本没生成**（Phase 14.22 bug-018 血的教训）
- 一定要 curl `/api/health` 看 prod runtime 状态，不能信控制台

### 教训 2：env 设置 ≠ 运行时可见
- EdgeOne env 列表里能看到 `OPENROUTER_API_KEY=sk-or-v1-***`，**不代表** runtime 能读到
- 必须勾选「运行时可见」（默认 build 时可见，runtime 需要单独勾）
- 验证手段：diagnose-env 端点返回 `runtime.present: true`

### 教训 3：mock 静默成功 = 重大隐患
- 如果 prod 同时存在 `USE_MOCK_AI=1` + `OPENROUTER_API_KEY=***`，ai-router **优先走 mock**，你永远不知道 OpenRouter 真的没工作
- 必须显式 `mockEnabled: false` 作为前置条件

### 教训 4：test-helper 不能长期开
- `ENABLE_TEST_HELPERS=1` 让内部 diagnose-env 暴露 → 是潜在信息泄露
- debug 完**立刻删 env**，不留到生产时段

## 修复 / 改进

| # | 措施 | 状态 |
|---|---|---|
| 1 | prod verify 流程标准化为 4 阶段（health → env → 业务 → 对话） | ✅ |
| 2 | 验证完关 ENABLE_TEST_HELPERS（EdgeOne 控制台手动） | ✅ 2026-07-20 验证 404 |
| 3 | `docs/EDGEONE_ENV_INJECT_2026-07-17.md` 加 SOP 章节 | ✅ |
| 4 | `.knowledge/decisions/2026-07-20-turnstile-deadline.md` 提醒 07-24 关 DISABLE_TURNSTILE | ✅ cron 已设置 id=bc20aeb8 |
| 5 | ai-router 加日志：每次选择 provider 时打印 `provider=openrouter|mock` | 🔜 未来改进 |

## 验证记录

| 验证项 | 时间 | 结果 |
|---|---|---|
| `/api/health` 返回 `ai.enabled:["openrouter"]` | 2026-07-19 16:53 | ✅ |
| `/api/test-helper/diagnose-env` 返回 404 | 2026-07-19 16:53 | ✅ prod 收紧 |
| 上传简历真 AI 提取姓名/年限/技术栈 | 2026-07-19 16:55 | ✅ "测试用户/10 年/7 项技能" |
| SSE 流返回真 AI 提问 | 2026-07-19 16:55 | ✅ "双11/50万 QPS/STAR 前置" + 24.4s 延迟 |

## 防退化 checklist

- [ ] 任何 AI provider 上 prod 前必须走 4 阶段验证 SOP
- [ ] prod env 不能同时存在 `USE_MOCK_AI=1` 和真实 provider key
- [ ] 任何 test-helper 端点 prod 默认 404（unset 状态，不是设 0）
- [ ] EdgeOne 控制台每次改 env 必须查「运行时可见」勾选
- [ ] 单测加 `tests/edgeone/prod-env.spec.ts`：模拟 4 种结果 + auto-assert

## 复利价值

下次再有类似"AI provider 上 prod"的场景：
1. 直接复用本卡的 4 阶段脚本（health → env → 业务 → SSE）
2. 不要相信控制台 build ✅
3. 必须跑 curl 看 runtime 真实状态
4. 验证完**立刻关** debug env（不留过夜）
