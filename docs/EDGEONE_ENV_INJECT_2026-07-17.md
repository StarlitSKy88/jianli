# EdgeOne Pages 环境变量注入清单 — 2026-07-17

> **触发原因**：B3 health 503 修复 + B8 prod AI provider 启用
> **执行者**：⚠️ 需要 昴君 手动在 EdgeOne 控制台 30 秒粘贴
> **生成时间**：2026-07-17

## 📋 控制台路径

```
EdgeOne 控制台 → Pages → interview-buddy → 环境变量 → 添加变量
```

## 🔑 待新增变量（1 个）

| Key | Value | 是否 Secret |
|-----|-------|-----|
| `OPENROUTER_API_KEY` | `sk-or-v1-***（您的真实 key，请在对话历史中查找 Phase 15.5 OpenRouter 注入段）***` | ✅ 勾选"加密" |

## 🗑️ 待删除变量（1 个）

| Key | 当前值 | 原因 |
|-----|--------|------|
| `USE_MOCK_AI` | `1` | 已配真实 OpenRouter，mock 不再需要（避免 ai-router 路由走错优先级） |

## 🔍 部署后验证（curl 4 步）

部署完成后（约 3-5 分钟），在本地终端运行：

```bash
# 1. health 应该 200 + ai.enabled 含 openrouter
curl -s https://jianli.taomyst.top/api/health | python3 -m json.tool
# 期望: {"ok": true, "db": "up", "ai": {"enabled": ["openrouter"], ...}, ...}

# 2. 简历上传后 AI 提取应返回真实数据
curl -s -X POST https://jianli.taomyst.top/api/resume/upload \
  -H "Cookie: token=<your-jwt>" \
  -F "file=@/path/to/test-resume.pdf" | python3 -m json.tool
# 期望: parsed.yearsOfExperience > 0 + parsed.techStack.length > 0

# 3. 触发一次 AI 面试（用 e2e 自动化或手动 UI）
curl -s -X POST https://jianli.taomyst.top/api/interview/<id>/message \
  -H "Cookie: token=<your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"我做了 5 年后端"}],"finish":false}'
# 期望: SSE 流返回真实 AI 提问（非 mock 默认文本）

# 4. 关闭测试 helper（如不再需要）
curl -s https://jianli.taomyst.top/api/test-helper/diagnose-prisma-direct
# 期望: 404 (ENABLE_TEST_HELPERS 应该设为 0 或删除)
```

## 📌 待您决定

1. **关闭 ENABLE_TEST_HELPERS=1**？（prod 上线稳定后建议关，防止 debug 端点被滥用）
2. **关闭 USE_MOCK_AI=1**？（已添加 OpenRouter，建议关 mock 让 ai-router 走真实 provider）
3. **保留 DISABLE_TURNSTILE=1 多久？**（按您要求保留 1 周至 2026-07-24）