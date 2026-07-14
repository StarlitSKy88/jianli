---
id: pattern-2026-07-15-001
title: YAML/MD prompt 加载器统一模式
category: pattern
severity: medium
tags: [prompt, yaml, loader, gray-matter, design-pattern]
created_at: 2026-07-15
project: interview-buddy

problem: |
  系统有多个 prompt（4 家面试官 system-prompt + 8 家关键维度 scorer prompt），
  如果硬编码在 TS 里，会有 3 个问题：
  1. prompt 修改要重新 build + 部署
  2. prompt 不能 diff review（混在代码里）
  3. 业务分析师想调 prompt 必须改代码

solution: |
  统一 prompt 加载器模式（interviewer + scorer 都在用）：

  1. 文件位置：`.knowledge/agents/{type}/{company}[/{dimension}].md`
  2. front-matter 用 `gray-matter` 解析 → zod schema 校验
  3. 安全防御：
     - 路径白名单（防 path traversal）
     - 文件大小上限 64KB（防 OOM）
     - resolved path 必须 startsWith ROOT
     - front-matter 中 company/dimension 与路径必须一致
  4. 内存缓存（避免重复 IO）
  5. 提供 clearCache() 给热加载/测试用

  ```typescript
  // lib/scoring/prompt-loader.ts（与 interviewer/prompt-loader.ts 同款）
  const ROOT = path.resolve(process.cwd(), '.knowledge', 'agents', 'scorer');
  const MAX_FILE_SIZE = 64 * 1024;

  export function loadScorerPrompt(company, dimension) {
    if (!COMPANY_SET.has(company)) throw ...;
    if (!DIMENSION_SET.has(dimension)) throw ...;
    const key = `${company}/${dimension}`;
    if (cache.has(key)) return cache.get(key);
    const resolved = path.resolve(ROOT, company, `${dimension}.md`);
    if (!resolved.startsWith(ROOT + path.sep)) throw ...; // 路径越界
    if (!fs.existsSync(resolved)) throw ...;
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_FILE_SIZE) throw ...;
    const raw = fs.readFileSync(resolved, 'utf-8');
    const parsed = matter(raw);
    const meta = MetaSchema.parse(parsed.data);
    if (meta.company !== company) throw ...; // 一致性
    cache.set(key, { meta, body: parsed.content.trim() });
    return cache.get(key);
  }
  ```

verification:
  unit: 16/16 prompt-loader 测试 + 85/85 全量测试
  integration: 4 公司 × 2 关键维度都能加载
  e2e: 待 Phase 9.4 Playwright

learned_from:
  - commit: Phase 9.3
  - file: lib/scoring/prompt-loader.ts + .knowledge/agents/scorer/{company}/{dimension}.md