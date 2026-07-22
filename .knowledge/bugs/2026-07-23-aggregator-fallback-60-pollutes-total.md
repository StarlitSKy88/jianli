---
id: bugs-2026-07-23-agg-fallback
title: aggregator 把缺失维度的 fallback 60 分错误计入总分加权
category: bugs
severity: high
tags: [scoring, aggregator, fallback, weighted-sum]
created_at: 2026-07-23
project: interview-buddy

problem: |
  lib/scoring/aggregator.ts line 30 把缺失维度的 60 分 fallback 也加进 used 对象:
  ```typescript
  for (const [dim, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    const s = input.scores[dim];
    const score = s ? s.score : DEFAULT_SCORE;  // 缺失 = 60
    radar[dim] = score;
    used[dim] = score * w;  // ← fallback 60 也进 used!
  }
  ```
  但 line 36-38 的 usedWeightSum 又 filter 排除缺失维度:
  ```typescript
  const usedWeightSum = (...).filter(([d,w]) => w>0 && input.scores[d])
                            .reduce((sum,[,w])=>sum+w, 0);
  ```

  **结果**:分子(含 60 fallback 贡献) > 实际加权贡献,分母只算传入维度权重。
  AI 部分失败时总分被 60 分"稀释"成不合理的低分,但**雷达图显示高分** → 自相矛盾。

  复现:
  - tencent 5 维度(pressure/project/star/tech/culture)
  - 只传 3 维度(pressure=68/project=78/star=77),tech/culture 缺失
  - 加权: (68*0.25 + 78*0.3 + 77*0.2 + 60*0.15 + 60*0.1) / (0.25+0.3+0.2)
  - 旧代码: (17 + 23.4 + 15.4 + 9 + 6) / 0.75 = 94.4 → 94 ❌
  - 期望: (17 + 23.4 + 15.4) / 0.75 = 74.4 → 74 ✅

solution: |
  修 used 赋值,加 if (s) 守卫,fallback 不参与总分加权:

  ```typescript
  for (const [dim, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    const s = input.scores[dim];
    const score = s ? s.score : DEFAULT_SCORE;
    radar[dim] = score;
    // Bug 修复:只有实际传入 score 的维度才进总分加权
    if (s) used[dim] = score * w;
  }
  ```

  **设计意图**:
  - radar:展示所有启用维度(含 60 fallback),让前端知道"这维度 AI 没评分"
  - totalScore:只算真实评分的维度加权,避免 AI 失败稀释总分

verification:
  unit: "tests/unit/scoring-differentiation.test.ts:aggregate 缺失维度 期望 74 实得 74"
  integration: "byte P7 完整评分 totalScore=77(无缺失场景)"
  e2e: "26 轮对话全跑通,5 维度都拿到分数(无 fallback 触发)"

learned_from:
  - file: lib/scoring/aggregator.ts
  - test: tests/unit/scoring-differentiation.test.ts
  - commit: TBD

debugging_trace: |
  1. Round 5 写 aggregate 单元测试,tencent 3/5 维度期望 74 实得 94
  2. 手算验证:usedWeightSum=0.75, weightedSum=70.8(60 污染) → 70.8/0.75=94.4
  3. 读 aggregator.ts:30 发现 used 累加了 fallback 60*w
  4. 加 if (s) 守卫 → 总分 = 55.8/0.75 = 74.4 → 74 ✅

anti_pattern: |
  **禁止在"加权求和"和"分母归一"用不同的 filter 条件**:
  分子分母必须用同一个 filter,否则数学上必然稀释/放大。
  这里是 used (分子) 没 filter, usedWeightSum (分母) filter 了,导致不一致。

follow_up:
  - 考虑把 radar 和 totalScore 的"是否包含 fallback"明确分两个函数,避免类似 bug
  - 加 property-based test:任何 (公司, score 子集) 组合,totalScore ∈ [传入分数的加权范围]