/**
 * Mock AI Provider — 测试环境专用
 *
 * 用法：USE_MOCK_AI=1 pnpm dev
 * 不消耗任何真实 API 配额，返回 30 个不同问题模拟完整面试
 *
 * Phase 14.4 用途：隔离真实 provider quota 耗尽问题，验证代码本身正确性
 *
 * 设计：
 *   - 30 个不同问题，覆盖字节面试全流程（暖场 → 项目 → 技术深度 → 系统设计 →
 *     算法/CS → 价值观 → 抗压 → 反馈）
 *   - 评分阶段根据 system prompt 中的维度关键词返回差异化分数
 *   - 这样 CI 能验证"每个维度的 prompt 真的进了 AI 输入"
 *
 * Phase 14.4 subagent 评审修复 #142：
 *   之前所有维度评分返回字面量重复的 75 分 → 遮蔽真实 P0 修复效果
 *   现在按维度差异化返回不同分数 + evidence + suggestions
 */
import type { AiProvider, ChatMessage, ChatOptions, ChatResult, StreamChunk } from './types';

type Dimension = 'tech' | 'project' | 'sysdesign' | 'algo' | 'cs' | 'culture' | 'star' | 'pressure';

interface MockResponse {
  question: string;
  dimension: Dimension;
  phase: 'warmup' | 'deep' | 'pressure' | 'feedback';
  nextFocus?: string;
}

interface MockScoreResponse {
  score: number;
  evidence: string;
  suggestions: string[];
}

const MOCK_RESPONSES: MockResponse[] = [
  // === 暖场 (Round 1-3) ===
  {
    question:
      '你好，欢迎来到字节跳动后端工程师面试。请先做个自我介绍，聊聊你最近 2 年最自豪的技术项目？',
    dimension: 'project',
    phase: 'warmup',
    nextFocus: '深度挖掘项目动机',
  },
  {
    question: '这个项目当时的业务背景是什么？为什么是你来做？',
    dimension: 'project',
    phase: 'warmup',
    nextFocus: '个人贡献占比',
  },
  {
    question: '你在项目里做的最有技术含量的事情是什么？量化下结果。',
    dimension: 'project',
    phase: 'deep',
    nextFocus: '技术方案细节',
  },
  // === 项目深度 (Round 4-8) ===
  {
    question: '你提到用了 Redis Pipeline，能具体讲讲当时为什么不用 MGET？性能差异是多少？',
    dimension: 'tech',
    phase: 'deep',
    nextFocus: '同类方案对比',
  },
  {
    question: 'Flink 的 watermark 机制在你这个场景下具体怎么配的？遇到过乱序导致数据丢失的情况吗？',
    dimension: 'tech',
    phase: 'deep',
    nextFocus: '线上踩坑经验',
  },
  {
    question:
      '你提到用 Redis Lua 脚本做库存扣减，如果 Lua 脚本执行时间超过 5 秒会怎样？怎么设计监控告警？',
    dimension: 'tech',
    phase: 'deep',
    nextFocus: '故障处理能力',
  },
  {
    question: 'Kafka 的 ISR 收缩机制你在线上遇到过吗？当时的告警策略是怎么设计的？',
    dimension: 'tech',
    phase: 'deep',
    nextFocus: 'SRE 能力',
  },
  {
    question: '幂等性的实现里 PID + sequence number 这个方案，broker 端 OOM 的风险你评估过吗？',
    dimension: 'tech',
    phase: 'deep',
    nextFocus: '风险意识',
  },
  // === 系统设计 (Round 9-15) ===
  {
    question: '现在让你从零设计一个抖音推荐系统的后端，你会怎么拆模块？',
    dimension: 'sysdesign',
    phase: 'deep',
    nextFocus: '架构能力',
  },
  {
    question: '推荐系统的召回层你用 HNSW 还是 IVF？索引重建的停机时间怎么压到 0？',
    dimension: 'sysdesign',
    phase: 'deep',
    nextFocus: '向量检索',
  },
  {
    question: '如果让你设计一个扛百万 QPS 的直播间弹幕系统，你会怎么分层？',
    dimension: 'sysdesign',
    phase: 'deep',
    nextFocus: '高并发设计',
  },
  {
    question: '消息队列选型上，Kafka 和 RocketMQ 你会怎么取舍？为什么？',
    dimension: 'sysdesign',
    phase: 'deep',
    nextFocus: '中间件选型',
  },
  {
    question: '秒杀系统的库存扣减，你认为 Redis + Lua 是最优解吗？有没有更好的方案？',
    dimension: 'sysdesign',
    phase: 'deep',
    nextFocus: '深度思考',
  },
  {
    question: '假设服务 QPS 突然从 1w 涨到 100w，你的限流、熔断、降级方案是什么？',
    dimension: 'sysdesign',
    phase: 'pressure',
    nextFocus: '抗压能力',
  },
  {
    question: '分布式锁的实现你了解几种？Redlock 在 Redis 主从切换时的安全性你怎么评价？',
    dimension: 'tech',
    phase: 'deep',
    nextFocus: '分布式一致性',
  },
  // === 算法与 CS (Round 16-22) ===
  {
    question: '来一道算法题：给定一个未排序数组，找出第 K 大的元素。要求时间复杂度 O(n)。',
    dimension: 'algo',
    phase: 'deep',
    nextFocus: '算法基础',
  },
  {
    question: '你刚用了快排的 partition，说说 partition 的稳定性如何？有没有不稳定的快速选择？',
    dimension: 'algo',
    phase: 'deep',
    nextFocus: '算法深度',
  },
  {
    question: 'TCP 三次握手能详细说下吗？为什么不是两次？',
    dimension: 'cs',
    phase: 'deep',
    nextFocus: '网络基础',
  },
  {
    question: '进程、线程、协程的区别是什么？Go 的 GMP 模型你了解吗？',
    dimension: 'cs',
    phase: 'deep',
    nextFocus: '操作系统',
  },
  {
    question: 'MySQL 的 InnoDB 引擎，为什么用 B+ 树而不是 B 树或红黑树？',
    dimension: 'cs',
    phase: 'deep',
    nextFocus: '存储引擎',
  },
  {
    question: '事务的 ACID 分别怎么实现？redo log 和 undo log 各自的作用是什么？',
    dimension: 'cs',
    phase: 'deep',
    nextFocus: '数据库事务',
  },
  {
    question: 'HTTPS 的握手过程能详细讲讲吗？中间人攻击怎么防御？',
    dimension: 'cs',
    phase: 'deep',
    nextFocus: '安全基础',
  },
  // === 价值观 & 抗压 (Round 23-27) ===
  {
    question: '你之前在字节做过 3 年，能聊聊你印象最深的一次跨团队协作吗？',
    dimension: 'star',
    phase: 'deep',
    nextFocus: 'STAR 复盘',
  },
  {
    question: '遇到技术方案和 Leader 意见不一致的时候，你一般怎么处理？',
    dimension: 'culture',
    phase: 'deep',
    nextFocus: '沟通能力',
  },
  {
    question: '线上出了 P0 故障，你作为 oncall 怎么处理？讲讲你的方法论。',
    dimension: 'pressure',
    phase: 'pressure',
    nextFocus: '应急能力',
  },
  {
    question: '字节强调"始终创业"，你怎么看？你觉得自己身上哪些特质匹配？',
    dimension: 'culture',
    phase: 'deep',
    nextFocus: '价值观匹配',
  },
  {
    question: '最近半年你读过哪些技术书？对自己的成长有什么规划？',
    dimension: 'star',
    phase: 'deep',
    nextFocus: '自驱力',
  },
  // === 反馈 (Round 28-30) ===
  {
    question: '你有什么想问我的？聊聊你对接下来的工作内容、团队氛围、职业发展有什么期待。',
    dimension: 'culture',
    phase: 'feedback',
    nextFocus: '双向沟通',
  },
  {
    question: '如果给你 offer，你最快什么时候能入职？',
    dimension: 'culture',
    phase: 'feedback',
  },
  {
    question: '今天的面试到这里，感谢你的时间，我们会尽快给你反馈。',
    dimension: 'culture',
    phase: 'feedback',
  },
];

/**
 * 评分响应 — 按维度差异化 (#142 修复)
 *
 * 关键：scorer 系统 prompt 中包含 `- 评分维度：${dimension}` 字符串
 * 通过正则提取 dimension 关键词，返回该维度专属的 score/evidence/suggestions
 *
 * 之前所有维度都是字面量 75 分 + 相同 evidence → subagent 评审发现遮蔽 P0 修复
 */
const MOCK_SCORE_BY_DIMENSION: Record<Dimension, MockScoreResponse> = {
  tech: {
    score: 82,
    evidence:
      'Redis Pipeline / Lua / Kafka ISR 答得不错，Flink watermark 配置经验有深度，但 producer 幂等性 OOM 风险讨论偏浅。',
    suggestions: [
      '深入 Kafka producer acks=all + idempotent 的故障场景',
      '补充 Redis 集群脑裂的处理经验',
      '梳理消息不丢的端到端链路',
    ],
  },
  project: {
    score: 78,
    evidence:
      '项目背景和量化结果清晰（70% 网络往返优化），个人贡献占比明确（订单系统重构负责人）。',
    suggestions: [
      '用 STAR 法则展开最自豪的项目',
      '补充项目失败/反思案例',
      '量化收益时给出对比基线',
    ],
  },
  sysdesign: {
    score: 72,
    evidence:
      '推荐系统分层合理（召回/排序/重排），但召回层 HNSW/IVF 细节欠打磨；秒杀场景分析到位。',
    suggestions: [
      '强化向量检索（HNSW/IVF）落地经验',
      '补充 P99 延迟优化的具体手段',
      '细化千万 QPS 限流熔断的开关阈值',
    ],
  },
  algo: {
    score: 76,
    evidence: '快速选择实现正确（O(n) partition），partition 稳定性分析准确，能给出非递归实现。',
    suggestions: [
      '补充随机化 pivot 应对最坏 O(n²)',
      '练习堆排和 BFPRT 等变种',
      '代码鲁棒性（边界、重复元素）需强化',
    ],
  },
  cs: {
    score: 80,
    evidence:
      'B+ 树（磁盘 IO 角度）、TCP 三次握手、ACID 实现答得全，HTTPS 提到证书链但 TLS 1.3 握手过程没展开。',
    suggestions: [
      'HTTPS 证书链与 TLS 1.3 握手过程需要更深入',
      '补充 Go GMP 调度模型抢占细节',
      '深入 MVCC 在 RR/RC 隔离级别下的差异',
    ],
  },
  culture: {
    score: 74,
    evidence: '"始终创业"理解到位，跨团队协作有具体 STAR 例子；与 Leader 分歧处理偏被动。',
    suggestions: [
      '准备与 Leader 决策冲突的具体案例',
      '补充字节文化（Context not Control）的理解',
      '展示自驱推动项目的例子',
    ],
  },
  star: {
    score: 77,
    evidence: '3 个 STAR 故事结构完整（跨团队协作 + 项目贡献 + 自驱成长），结果可量化。',
    suggestions: ['补充失败案例的反思', 'Situation 段落可以更具体', 'Result 增加过程指标'],
  },
  pressure: {
    score: 68,
    evidence: 'P0 oncall 方法论清晰（止损 → 定位 → 修复 → 复盘），但缺少实际 case。',
    suggestions: [
      '准备 1 个真实的 P0 故障案例',
      '细化 5 Why 复盘方法论',
      '量化 oncall 的 SLA 指标',
    ],
  },
};

/**
 * 从 system prompt 中提取维度关键词
 * 例如 system 包含 "- 评分维度：tech" → 返回 'tech'
 */
function extractDimensionFromSystem(systemPrompt: string): Dimension | null {
  const m = systemPrompt.match(/评分维度[：:]\s*(\w+)/);
  if (!m) return null;
  const dim = m[1] as Dimension;
  return dim in MOCK_SCORE_BY_DIMENSION ? dim : null;
}

class MockProvider implements AiProvider {
  readonly name = 'mock';
  private callCount = 0;

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    this.callCount++;

    // === 评分模式检测 ===
    // 关键改进 #142：用 system prompt 维度关键词而不是 callCount 阈值
    // 这样无论 scorer 在哪个时序调用，都能返回正确维度的评分
    const systemMsg = messages.find((m) => m.role === 'system');
    const dimension = systemMsg ? extractDimensionFromSystem(systemMsg.content) : null;

    let content: string;
    if (dimension) {
      // 评分模式：返回该维度的差异化分数
      content = JSON.stringify(MOCK_SCORE_BY_DIMENSION[dimension]);
    } else {
      // 面试官模式：按 callCount 返回 30 个不同问题
      const idx = Math.min(this.callCount - 1, MOCK_RESPONSES.length - 1);
      content = JSON.stringify(MOCK_RESPONSES[idx]);
    }

    return {
      content,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      provider: this.name,
      model: 'mock-v1',
    };
  }

  async streamChat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResult> {
    const r = await this.chat(messages, opts);
    onChunk?.({ type: 'content', content: r.content });
    onChunk?.({ type: 'done' });
    return r;
  }
}

let _instance: MockProvider | null = null;

export function getMockProvider(): MockProvider | null {
  if (process.env.USE_MOCK_AI !== '1') return null;
  if (!_instance) _instance = new MockProvider();
  return _instance;
}
