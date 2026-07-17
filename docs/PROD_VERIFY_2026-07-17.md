# Prod 部署验证清单 — 2026-07-17

> **触发原因**：B8 OPENROUTER_API_KEY 是否真生效
> **部署状态**：commit `5e8c1a0` 已 push，EdgeOne 自动部署中
> **预计可用时间**：push 后 3-5 分钟

## 🟢 您可以现在做的事

### 1️⃣ 验证 health（B3 已生效，应返回 200 + warn）

```bash
curl -s https://jianli.taomyst.top/api/health | python3 -m json.tool
```

**期望输出**：
```json
{
  "ok": true,
  "db": "up",
  "ai": {
    "enabled": ["openrouter"],  ← 如果有 OpenRouter 就含这个
    "total": 4,
    "mockEnabled": false
  },
  "warn": "NO_AI_PROVIDER"  ← 如果 enabled 空，仍 200 但有 warn
}
```

### 2️⃣ 验证 env 是否真生效（B10 诊断端点）

```bash
curl -s https://jianli.taomyst.top/api/test-helper/diagnose-env | python3 -m json.tool
```

**如果 ENABLE_TEST_HELPERS=1 在 prod**（之前 subagent 报告显示是 1）：
```json
{
  "ok": true,
  "envAtRuntime": {
    "OPENROUTER_API_KEY": {
      "present": true,
      "length": 73,
      "prefix": "sk-or-v1-",       ← 您的 key 前缀
      "suffix": "2d37",            ← 您的 key 后缀
      "looksLikePlaceholder": false
    },
    ...
  }
}
```

**如果 ENABLE_TEST_HELPERS 已删除**：会返回 404，那我们需要走另一条路径。

### 3️⃣ 业务级验证（最直观）

浏览器手动流程：
1. 访问 https://jianli.taomyst.top/login
2. 用 `20925250@qq.com` + `Hello2026!` 登录
3. 上传一份简历（任何 PDF/DOCX）
4. 创建面试 → 选公司 + 岗位
5. **关键测试**：看 AI 是否返回**真实内容**（而不是 mock 文本 "这是一个示例回答"）

## 📊 4 种可能结果 + 对应处理

| diagnose-env 输出 | 含义 | 处理 |
|---|---|---|
| `OPENROUTER_API_KEY.present: true, prefix: sk-or-v1-` | ✅ env 生效 | B8 完成 ✅ |
| `OPENROUTER_API_KEY.present: false` | ❌ env 未传到 runtime | EdgeOne env 没勾"运行时可见" |
| `OPENROUTER_API_KEY.present: true, looksLikePlaceholder: true` | ⚠️ env 是占位符 | 您加的是 placeholder 不是真 key |
| 404 (test-helper disabled) | ⚠️ helper 已关 | 走业务验证（方案 3） |

## 📌 您能给蕾姆的最有价值的事

**3 分钟后**（EdgeOne 部署完成）curl 上面 2 个命令，把输出贴给蕾姆 — 蕾姆立刻看出 env 状态：

1. **如果 prefix 不对**：env 名错
2. **如果 present=false**：env 作用域错（构建时 vs 运行时）
3. **如果 looksLikePlaceholder=true**：您加的可能是模板字符串不是真 key
4. **如果都正常**：B8 完工，可以走业务验证

## 🔧 备用方案（如果 env 一直不生效）

| 方案 | 步骤 |
|---|---|
| **A. 重命名 + 重建** | EdgeOne env 名确保精确 `OPENROUTER_API_KEY`（大写下划线），然后 EdgeOne 控制台手动触发 rebuild |
| **B. 直接配 EdgeOne CLI** | `npx edgeone pages env set --key OPENROUTER_API_KEY --secret true`（如果 CLI 可用） |
| **C. fallback 用 USE_MOCK_AI=1** | 短期 mock，让业务先跑通；OpenRouter 待排查后再切 |

---

*(请 3 分钟后跑 curl 把输出贴回来，蕾姆在线解析)*