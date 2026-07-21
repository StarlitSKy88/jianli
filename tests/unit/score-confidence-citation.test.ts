/**
 * 防御性测试 — ScoreConfidence + 反幻觉引用（Phase 14.25）
 *
 * 覆盖：
 * 1. ScoreOutput schema 接受 confidence (0-1) 和 citationQuotes 数组
 * 2. guardCitation: 引用至少 1 个能在 transcript 找到 → 通过
 * 3. guardCitation: 全部引用找不到 → throw 反幻觉拦截
 * 4. guardCitation: 短引用（<10字）忽略，不算有效
 * 5. guardCitation: transcript 无 user 消息 → 跳过校验（不阻断）
 * 6. guardCitation: 旧 schema 无 citationQuotes → 跳过（向后兼容）
 *
 * Why this exists:
 *   - AI 评分最大风险是"幻觉"：编造候选人没说过的话当 evidence
 *   - 反幻觉门禁 = 强制 AI 引用原话片段 + 校验引用确实存在
 *   - 置信度 = 让用户/前端能看出"这次评分可不可信"
 */
import { describe, it, expect } from 'vitest';
import { guardCitation } from '@/lib/scoring/scorer';
import type { ScoreOutput } from '@/lib/scoring/dimensions';

const transcript = [
  { role: 'assistant' as const, content: '请介绍下 Redis Pipeline 和 MGET 的区别' },
  {
    role: 'user' as const,
    content:
      'MGET 是批量拉取多个 key，Pipeline 是分批执行多个命令。Pipeline 更灵活，支持不同长度的命令。我选择 Pipeline 因为我们的 key 数量会动态增长。',
  },
  { role: 'assistant' as const, content: '你提到 key 数量动态增长，能具体说说吗？' },
  {
    role: 'user' as const,
    content: '比如秒杀场景下，库存 key 一开始 1000 个，活动期间可能到 100w。',
  },
];

describe('ScoreOutput schema 扩展（Phase 14.25）', () => {
  it('接受 confidence + citationQuotes', async () => {
    const { ScoreOutputSchema } = await import('@/lib/scoring/dimensions');
    const r = ScoreOutputSchema.safeParse({
      score: 75,
      evidence: '回答了 Pipeline vs MGET 的区别',
      suggestions: ['补充 Pipeline 性能数据'],
      confidence: 0.8,
      citationQuotes: ['MGET 是批量拉取多个 key'],
    });
    expect(r.success).toBe(true);
  });

  it('confidence 必须在 0-1 之间', async () => {
    const { ScoreOutputSchema } = await import('@/lib/scoring/dimensions');
    expect(
      ScoreOutputSchema.safeParse({
        score: 75,
        evidence: 'x',
        suggestions: [],
        confidence: 1.5,
      }).success
    ).toBe(false);
    expect(
      ScoreOutputSchema.safeParse({
        score: 75,
        evidence: 'x',
        suggestions: [],
        confidence: -0.1,
      }).success
    ).toBe(false);
  });

  it('citationQuotes 最多 3 个', async () => {
    const { ScoreOutputSchema } = await import('@/lib/scoring/dimensions');
    const r = ScoreOutputSchema.safeParse({
      score: 75,
      evidence: 'x',
      suggestions: [],
      citationQuotes: ['a', 'b', 'c', 'd'],
    });
    expect(r.success).toBe(false);
  });

  it('向后兼容：旧 schema 不带 confidence/citationQuotes 仍可通过', async () => {
    const { ScoreOutputSchema } = await import('@/lib/scoring/dimensions');
    const r = ScoreOutputSchema.safeParse({
      score: 75,
      evidence: '旧版本输出',
      suggestions: ['建议 1'],
    });
    expect(r.success).toBe(true);
  });
});

describe('反幻觉校验 guardCitation', () => {
  const transcriptWithUser = [
    {
      role: 'user' as const,
      content: 'Redis Pipeline 适合动态增长的 key 数量场景，MGET 适合固定少量 key',
    },
  ];

  it('1 个有效引用 → 通过', () => {
    const out: ScoreOutput = {
      score: 75,
      evidence: '候选人讨论了 Pipeline 适用场景',
      suggestions: [],
      citationQuotes: ['Redis Pipeline 适合动态增长的 key 数量场景'],
    };
    expect(() => guardCitation(out, transcriptWithUser)).not.toThrow();
  });

  it('所有引用都找不到 → throw 反幻觉拦截', () => {
    const out: ScoreOutput = {
      score: 75,
      evidence: 'x',
      suggestions: [],
      citationQuotes: [
        '候选人说用了 Zookeeper 做分布式锁', // 完全不在 transcript 里
        '提到了 etcd 的 watch 机制', // 也不在
      ],
    };
    expect(() => guardCitation(out, transcriptWithUser)).toThrow(/反幻觉拦截/);
  });

  it('至少 1 个有效 → 通过（其他无效不阻断）', () => {
    const out: ScoreOutput = {
      score: 75,
      evidence: 'x',
      suggestions: [],
      citationQuotes: [
        'Redis Pipeline 适合动态增长的 key 数量场景', // ✓ 有效
        '提到 etcd 的 watch 机制', // ✗ 无效
      ],
    };
    expect(() => guardCitation(out, transcriptWithUser)).not.toThrow();
  });

  it('短引用（< 10 字）不计入有效（避免误报）', () => {
    const out: ScoreOutput = {
      score: 75,
      evidence: 'x',
      suggestions: [],
      citationQuotes: ['Redis', 'Pipeline', 'MGET'], // 都 < 10 字
    };
    expect(() => guardCitation(out, transcriptWithUser)).toThrow(/反幻觉拦截/);
  });

  it('引用含部分字符匹配 → 通过', () => {
    // transcript 包含 "Pipeline 适合动态增长的 key 数量场景"
    // quote 是其中片段
    const out: ScoreOutput = {
      score: 75,
      evidence: 'x',
      suggestions: [],
      citationQuotes: ['Pipeline 适合动态增长'],
    };
    expect(() => guardCitation(out, transcriptWithUser)).not.toThrow();
  });

  it('transcript 无 user 消息 → 跳过校验（不阻断）', () => {
    const emptyTranscript = [{ role: 'assistant' as const, content: '只有面试官提问' }];
    const out: ScoreOutput = {
      score: 75,
      evidence: 'x',
      suggestions: [],
      citationQuotes: ['凭空捏造的引用'], // 不存在也不阻断
    };
    expect(() => guardCitation(out, emptyTranscript)).not.toThrow();
  });

  it('旧 schema 无 citationQuotes → 跳过（向后兼容）', () => {
    const out: ScoreOutput = {
      score: 75,
      evidence: 'x',
      suggestions: [],
      // 没有 citationQuotes
    };
    expect(() => guardCitation(out, transcriptWithUser)).not.toThrow();
  });

  it('多 user 消息 → 拼接校验', () => {
    const longTranscript = [
      { role: 'assistant' as const, content: '问 1' },
      { role: 'user' as const, content: '回答 1：Kafka ISR 收缩机制' },
      { role: 'assistant' as const, content: '问 2' },
      { role: 'user' as const, content: '回答 2：Flink watermark 处理乱序' },
    ];
    const out: ScoreOutput = {
      score: 75,
      evidence: 'x',
      suggestions: [],
      citationQuotes: ['Flink watermark 处理乱序'], // 在第二条 user 里
    };
    expect(() => guardCitation(out, longTranscript)).not.toThrow();
  });
});

describe('置信度字段语义', () => {
  it('confidence 高（≥0.8）→ 评分可信', async () => {
    const { ScoreOutputSchema } = await import('@/lib/scoring/dimensions');
    const r = ScoreOutputSchema.parse({
      score: 80,
      evidence: '具体回答 + 引用',
      suggestions: [],
      confidence: 0.9,
    });
    expect(r.confidence).toBe(0.9);
  });

  it('confidence 低（<0.5）→ 前端应展示"需人工复盘"标记', async () => {
    const { ScoreOutputSchema } = await import('@/lib/scoring/dimensions');
    const r = ScoreOutputSchema.parse({
      score: 60,
      evidence: '反幻觉降级触发',
      suggestions: [],
      confidence: 0.3,
    });
    expect(r.confidence).toBe(0.3);
  });
});
