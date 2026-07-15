# Bug-017: EdgeOne Pages CDN 缓存不自动同步（必须手动 purge）

**日期**: 2026-07-16
**严重度**: critical
**项目**: interview-buddy
**前置卡片**: bug-016 (EdgeOne 无自动 rebuild)

## 现象

bug-016 修复后用户手动点了"重新部署"，EdgeOne 控制台显示部署详情：
- 状态：✅ 成功
- 时间：2026/07/16 02:31:59
- 提交：9f6df11
- 构建用时：128s

但 curl 探测发现：
- `curl -I /sitemap.xml` → `Date: Wed, 15 Jul 2026 18:45:04 GMT`（**昨天**！）
- `Last-Modified: Wed, 15 Jul 2026 18:33:24 GMT`
- webpack hash `1b1c319448642724` 还是昨天的 build

prisma binary 修复仍然看起来"不工作"——其实代码根本没被 CDN 边缘节点服务到。

## 真凶

EdgeOne Pages **build 成功 ≠ CDN 同步**：
1. EdgeOne Pages backend 收到新 build → 标记状态为"成功"
2. 但是 **CDN 边缘节点 cache 没自动 purge**
3. 边缘节点继续用昨天的旧 build 产物响应请求
4. 直到手动 purge cache 或 TTL 过期（max-age=0 但实际边缘仍 sticky）

## 修复（用户操作）

EdgeOne 控制台 → 项目 → 缓存管理 / 缓存配置 / 刷新缓存 / Purge Cache
→ 选"全部内容" / "所有 URL" → 点确认

## 教训（EdgeOne Pages 部署铁四角）

| # | 文件 | 关键配置 | 自动/手动 |
|---|---|---|---|
| 1 | `prisma/schema.prisma` | `binaryTargets` | 跟代码走 |
| 2 | `next.config.js` | `outputFileTracingIncludes` | 跟代码走 |
| 3 | `edgeone.json` | `cloudFunctions.externalNodeModules + includeFiles` | 跟代码走 |
| 4 | **手动点"重新部署"** | EdgeOne 控制台 | **手动** |
| 5 | **手动 purge CDN cache** | EdgeOne 控制台 → 缓存管理 | **手动** |

任一缺失都会让 prod 看似"修了"但实际跑老代码。

## 附：EdgeOne Date header 系统时钟 bug

观察到的诡异现象：
- `curl -I jianli.taomyst.top` → `Date: Wed, 15 Jul 2026 19:36 GMT`（昨天/今天早上）
- 同时 `Last-Modified: Wed, 15 Jul 2026 19:02:11 GMT`（与 sitemap lastmod 19:01:44 一致，是今天的 build）
- 业务响应正确（curl send-verify-code → 400 TURNSTILE_FAILED）

**结论**：EdgeOne Pages 的 `Date` HTTP header 字段似乎有显示 bug，不会随真实时间更新。
不影响 `Last-Modified`（这是文件实际修改时间）和业务逻辑，但会误导诊断。

**如何判断 prod 是否真的更新**：
- ✅ `Last-Modified` 时间应该是新 build 时间（≈ git log 时间）
- ✅ `curl send-verify-code` 应该返回 400/200/429（不是 500）
- ✅ `Eo-Pages-Inner-Scf-Status` header 反映 SSR 真实行为
- ❌ 不要看 `Date` header（EdgeOne 系统时钟 bug）

## 部署后必查（v2 checklist）

```bash
# Step 1: 验证部署成功
# 用户截图：EdgeOne 控制台 → 部署详情 → ✅ 成功 + commit hash 正确

# Step 2: 验证 CDN 同步
curl -sS -I https://your-domain/sitemap.xml 2>&1 | grep -iE "date|last-modified"
# 期望：Date 是部署后时间（±30 分钟）

# Step 3: 验证 sitemap 内容更新
curl -sS https://your-domain/sitemap.xml | grep lastmod | head -1
# 期望：lastmod 应该是部署时间附近的 ISO timestamp

# Step 4: 验证静态资源是新 build
curl -sS https://your-domain/ | grep -oE 'webpack-[a-f0-9]+\.js' | head -1
# 期望：与本地 build 的 webpack hash 一致（pnpm build 输出）

# Step 5: API 端到端测试
curl -X POST -H "Content-Type: application/json" \
  -d '{"email":"probe@test.com","turnstileToken":"dummy"}' \
  https://your-domain/api/auth/send-verify-code
# 期望：TURNSTILE_FAILED（说明 prisma 调用前的代码路径都通了）

# Step 6: 完整业务流（用户浏览器）
# 浏览器 Cmd+Shift+R 强刷 → 输入邮箱 → 点获取验证码
# 期望：qq.com 收件箱真邮件
```

如果 Step 2-5 任一失败但 Step 1 显示成功 → EdgeOne CDN 没同步 → 手动 purge cache。

## Why & How to apply

- **Why**：EdgeOne Pages 2026 年 7 月当前版本，build pipeline 标记成功但 CDN
  propagation 是另一个异步过程。max-age=0 + must-revalidate 在客户端表现正常，
  但 CDN 边缘节点之间仍有内部缓存层（EO-Cache-Status: Cache Miss 不代表
  节点拿到了最新内容）。
- **How**：
  - 任何 EdgeOne Pages 部署后必查 5 项 checklist
  - 长效解（Phase 15+）：用 edgeone CLI 配置 auto-deploy + auto-purge hook
  - 临时解：每次重要变更后手动 purge cache（30 秒操作）