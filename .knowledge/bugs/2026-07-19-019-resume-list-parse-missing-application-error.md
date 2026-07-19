# Bug-019: /api/resume 返回缺 parsed 字段 → 触发 Next.js 红屏 "Application error"

**日期**: 2026-07-19
**严重度**: high（用户感知严重，但不影响数据完整性）
**项目**: interview-buddy
**前置卡片**: 014-cloud-functions-external-modules（同根：API 返回 schema 与前端期望不一致）
**后续卡片**: 无

## 现象（用户体验最糟）

用户操作：
1. 访问 `/interview/new`（已登录态）
2. 上传简历（multipart）—— 后端 200 OK ✅ + structured AI 提取成功
3. 看到一行**已上传简历**（"XX 6 年经验 · **未提取技能**"）
4. 浏览器顶部弹红框：**"Application error: a client-side exception has occurred (see the browser console for more information)."**

—— **页面其他部分变白屏 / 红屏**，只剩报错信息。

诊断时间：约 25 分钟（蕾姆 + Playwright + 浏览器 console 分析）

## 真凶（三层叠加）

### 凶手 #1：`/api/resume` (GET) select 缺字段

```typescript
// app/api/resume/route.ts (修复前)
const list = await prisma.resume.findMany({
  ...
  select: {
    id: true,
    name: true,
    yearsOfExperience: true,
    createdAt: true,  // ❌ 缺 techStack + parsed
  },
});
```

而 `/api/resume/upload` (POST) 返回字段完整（id + name + yearsOfExperience + techStack + createdAt）。

—— **GET vs POST 字段不一致** = **API schema 漂移**。

### 凶手 #2：前端使用 `r.parsed?.skills` 但 API 不返回 parsed

`app/interview/new/page.tsx` line 96-98:
```tsx
{r.yearsOfExperience || 0} 年经验 ·{' '}
{r.parsed?.skills?.slice(0, 5).join(' / ') || '未提取技能'}
```

`ResumeUploader.onUploaded(d.resume)` 触发 `setResumes` 时把 `d.resume`（**只有 id/name/yearsOfExperience/techStack/createdAt**）当 `Resume` 类型 assertion cast：

```tsx
onUploaded={(r) => {
  setResumes((prev) => [
    { ...r, parsed: (r.parsed as Resume['parsed']) || {} } as Resume,
    ...prev,
  ]);
}}
```

由于 `r.parsed === undefined` 但被强制断言为 `'object'`（TS 撒谎），运行时实际拿到 undefined 后再 fallback `|| {}`。 —— 在 React strict mode / hydration 严格模式下，这种"类型撒谎"可能在某些 path 触发 React detect hydration mismatch，**升级为 client-side exception → 红屏**。

### 凶手 #3：没有 `app/global-error.tsx`

Next.js 14 默认 client component 抛未捕获错误时：
- 找最近的 `error.tsx` → 找不到 → 找 `global-error.tsx` → **也没**
- 降级到 Next.js 内置红屏："Application error: a client-side exception has occurred"

—— **没有兜底 = 用户 100% 看到红屏**，无法恢复。

## 真因（深层）

1. **API 缺乏统一 schema 契约** —— GET/POST 返回字段不一致
2. **前端 type assertion 撒谎** —— `as Resume['parsed']` 静默吞错
3. **Next.js error.tsx 缺失** —— 红屏是 Next.js 默认行为，没预防
4. **useEffect 静默吞 fetch error** —— `catch { /* ignore */ }` 永远不暴露根因

## 修复（三层防御）

### 修复 1：API 对齐契约 (app/api/resume/route.ts)

```typescript
// ✅ select 添加 techStack + parsed
const list = await prisma.resume.findMany({
  ...
  select: {
    id: true,
    name: true,
    yearsOfExperience: true,
    techStack: true,  // + 与 POST 一致
    parsed: true,     // + 与 POST 一致
    createdAt: true,
  },
});

// ✅ 防御性 normalize: 防 null/undefined/数组/字符串脏数据
const normalized = list.map((r) => {
  const p = r.parsed;
  const parsed = p && typeof p === 'object' && !Array.isArray(p)
    ? p : {};
  const ts = Array.isArray(r.techStack) ? r.techStack : [];
  return { ...r, parsed, techStack: ts };
});
```

### 修复 2：前端运行时强制 normalize (page.tsx)

不再相信 cast，在 useEffect 里 normalize：
```tsx
const list = (d.resumes || []).map((row) => ({
  ...row,
  parsed:
    row.parsed && typeof row.parsed === 'object' && !Array.isArray(row.parsed)
      ? row.parsed
      : {},
  techStack: Array.isArray(row.techStack) ? row.techStack : [],
}));
```

`catch` 不再静默：留 `console.warn` 帮调试。

### 修复 3：app/global-error.tsx 兜底 (新)

拦截所有未捕获错误，渲染可读错误卡片 + 重试按钮 + 返回首页。
任何 client component 抛未捕获错误时，**用户**永远**看不到红屏**。

### 修复 4：测试固化 (tests/unit/resume-list.test.ts)

6 个测试场景：
1. 401 未登录
2. 返回字段完整 (id/name/yearsOfExperience/techStack/parsed/createdAt)
3a. parsed=null → {}
3b. parsed=数组 → {}（脏数据）
4. techStack 非数组 → []
5. orderBy createdAt desc + take 20

—— 任何未来 regress select 字段，必触发 CI 失败。

## 验证

| 验证项 | 结果 |
|---|---|
| `pnpm type-check` | 0 errors ✅ |
| `pnpm test` (vitest) | **155/155** passed（基线 132 + 新增 6 + 17 已有）✅ |
| 新测试 6/6 | ✅ 覆盖 5 个 schema 契约 + 1 个排序 |
| 老回归 | 16 file × 全部 passed ✅ 无破坏 |

## 防退化清单（auto-check 建议写到 CI）

- [ ] `pnpm test tests/unit/resume-list.test.ts` 必过（6/6）
- [ ] `app/api/resume/route.ts` 的 `select` 不可漏字段（建议提到 `RESUME_LIST_SELECT` 常量 + 复用）
- [ ] 任何新 GET/POST 端点必须返回**完全一致的 schema**（建议通过 zod schema 一处定义）
- [ ] `app/global-error.tsx` 必须存在（建议在 PR review 必查）
- [ ] client component 的 `useEffect` 不能 `catch {}` 静默吞（建议改用 `console.warn` + error reporter）

## 教训

1. **API schema 对齐 = 0 容忍**：同一资源不同 verb 返回字段不一致 = 灾难
2. **类型断言不是运行时校验**：`as Type` 是 TS 层谎言，运行时崩不报错
3. **Next.js error boundary 必须手动写**：默认行为就是红屏吓用户
4. **Playwright 模拟 ≠ 真实用户**：之前 curl 测 POST 200、page 加载 0 errors，但用户上传后看到红屏——**不能完全相信自动化信号**

## 复利价值

下次再遇到"Application error"红屏：
1. 立刻看 console.error（不是 console.warn）
2. 立刻查 `app/global-error.tsx` 是否存在 → 不存在补上
3. 立刻看所有 client component 的 useEffect 是否静默吞 error → 加 console.warn
4. 立刻 GET/POST API 字段对比 → 不一致 = 根因
