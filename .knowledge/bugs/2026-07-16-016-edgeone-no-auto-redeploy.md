# Bug-016: EdgeOne Pages 没有 GitHub webhook 自动 rebuild

**日期**: 2026-07-16
**严重度**: critical（导致前面 bug-013/014/015 修复看起来全部失败）
**项目**: interview-buddy
**前置卡片**: bug-013 (Prisma binaryTargets) + bug-014 (standalone) + bug-015 (cloudFunctions)

## 现象

连续 3 次修复 prisma engine binary 缺失（bug-013 → 014 → 015），每次都"以为"修好了，
但用户浏览器看到的 500 错误一字不改：
```
验证码发送失败: Invalid `prisma.user.findUnique()` invocation:
Prisma Client could not locate the Query Engine for runtime "rhel-openssl-1.1.x"
```

## 真凶（不是 binary 问题，是部署问题）

EdgeOne Pages **没有 GitHub webhook 自动 rebuild**！

证据链：
1. `curl https://jianli.taomyst.top/sitemap.xml | grep lastmod` → `2026-07-15T18:12:31`
2. `git log -1 --format=%cI` → `2026-07-16T02:09:38`
3. 时间差 = **6+ 小时**，中间 push 了 6 个 commit
4. EdgeOne 当前部署 = `f02ba6c`（昨天 14.5 之前的版本）
5. 用户看到的 500 = 老代码的 prisma，从来没拿到过 binaryTargets 修复

## 为什么之前一直没发现？

- 本地 `pnpm test` 132/132 ✅
- 本地 `pnpm build` 0 warnings ✅
- 本地 `find .next/standalone -name "libquery_engine*"` 3 个 binary ✅
- 但是 EdgeOne 上跑的代码是昨天的！所有"修复"都被遗留在 master 上没部署

这是**最阴险的状态**：所有 dev 信号全 GREEN，但 prod 永远停在过去。

## 修复

### 立刻手动触发（用户操作）

1. https://console.cloud.tencent.com/edgeone/pages
2. 项目 jianli-buddy → 部署 → 找到 master commit 0485f44
3. 点 "重新部署" / "Redeploy" 按钮
4. 等 3-5 分钟 build 完成
5. 验证：curl sitemap.xml lastmod 应该是今天的时间

### 一劳永逸（Phase 15+ TODO）

选项 A: 安装 edgeone CLI + 配置 API token + 写 deploy.sh
选项 B: GitHub Actions 配 EdgeOne Pages deploy workflow
选项 C: 让 EdgeOne 控制台勾上"GitHub 推送自动部署"（如果有这个选项）

## 部署后必查（新增 checklist）

```bash
# 任何 commit push 到 master 后，30 秒内必跑：
curl -sS https://your-domain/sitemap.xml | grep lastmod | head -1
# 期望：lastmod 时间 ≈ git log -1 时间（±30 分钟）

# 关键 API 烟雾测试：
curl -X POST -H "Content-Type: application/json" \
  -d '{"email":"probe@test.com","turnstileToken":"dummy"}' \
  https://your-domain/api/auth/send-verify-code
# 期望：TURNSTILE_FAILED（不是 prisma 500）
# TURNSTILE_FAILED 说明 turnstile 之前的代码都跑通了（包括 prisma）
```

## Why & How to apply

- **Why**：EdgeOne Pages 是 Tencent Cloud Pages 产品，2026 年 7 月当前版本
  默认 GitHub webhook 行为是**只触发第一次 deploy**，后续 commit 不自动 rebuild。
  必须手动点"重新部署"或用 CLI/API 触发。这个产品行为和 Vercel / Cloudflare Pages
  完全不一样（那两个是真自动 deploy）。

- **How**：
  - 任何 EdgeOne Pages 项目，部署后必查 sitemap lastmod 作为健康检查
  - 部署文档 § 6.2 已更新，明确写"必须手动重新部署"
  - 长效解：配 GitHub Actions 或 edgeone CLI 自动 deploy（Phase 15+）