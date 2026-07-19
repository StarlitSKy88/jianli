/**
 * 面试官主类测试 — mock aiChat，覆盖 4 家 × 2 轮 + 异常路径
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/router', () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from '@/lib/ai/router';
import { Interviewer } from '../../lib/agents/interviewer';
import type { InterviewerContext, InterviewerType } from '../../lib/agents/interviewer';

const mockAiChat = vi.mocked(aiChat);

function makeCtx(company: InterviewerType): InterviewerContext {
  return {
    userId: 'u1',
    scenarioId: 's1',
    company,
    role: '后端工程师',
    level: 'P6',
    resume: {
      name: '王测试',
      yearsOfExperience: 12,
      skills: ['Go', 'Kubernetes'],
      projects: [
        {
          name: '电商核心交易',
          duration: '2023-2025',
          description: '负责订单系统重构',
          techStack: ['Go', 'MySQL', 'Redis'],
        },
      ],
    },
    history: [
      { role: 'user', content: '我最近做了一个订单系统重构。' },
      { role: 'assistant', content: '能详细说说吗？' },
    ],
  };
}

function makeMockResponse(question: string, dimension = 'tech') {
  return {
    content: JSON.stringify({ question, dimension, phase: 'deep' as const }),
    provider: 'minimax',
    model: 'MiniMax-M3',
  };
}

beforeEach(() => {
  mockAiChat.mockReset();
});

describe.each(['byte', 'ali', 'tencent', 'bili'] as const)('company=%s', (type) => {
  it('returns valid InterviewerOutput', async () => {
    mockAiChat.mockResolvedValueOnce(makeMockResponse(`测试问题 ${type}`, 'tech'));
    const iv = new Interviewer(makeCtx(type));
    const out = await iv.ask();
    expect(out.question).toBeTruthy();
    expect(['tech', 'project', 'sysdesign', 'algo', 'cs', 'culture', 'star', 'pressure']).toContain(
      out.dimension
    );
    expect(out.phase).toBeDefined();
  });

  it('passes ctx (resume) to system prompt', async () => {
    mockAiChat.mockResolvedValueOnce(makeMockResponse('测试'));
    const iv = new Interviewer(makeCtx(type));
    await iv.ask();
    const call = mockAiChat.mock.calls[0];
    const sysMsg = call[0].find((m) => m.role === 'system');
    expect(sysMsg?.content).toContain('后端工程师');
    expect(sysMsg?.content).toContain('王测试');
  });
});

describe('output parsing edge cases', () => {
  // P0-4 修复后行为变更：AI 输出非 JSON → 显式 throw（让 route catch 接住 STREAM_ERROR），
  // 不能再用 "请继续介绍您的项目" 等万能文案伪装成功（会污染 history）。
  it('throws on non-JSON AI output (P0-4: no more silent fallback)', async () => {
    mockAiChat.mockResolvedValueOnce({
      content: '好的，让我问你下一个问题：你最大的技术挑战是什么？',
      provider: 'minimax',
      model: 'MiniMax-M3',
    });
    const iv = new Interviewer(makeCtx('byte'));
    await expect(iv.ask()).rejects.toThrow(/AI 输出非 JSON/);
  });

  it('parses ```json fenced output', async () => {
    mockAiChat.mockResolvedValueOnce({
      content: '```json\n{"question":"讲讲 Redis 雪崩","dimension":"tech","phase":"deep"}\n```',
      provider: 'minimax',
      model: 'MiniMax-M3',
    });
    const iv = new Interviewer(makeCtx('byte'));
    const out = await iv.ask();
    expect(out.question).toBe('讲讲 Redis 雪崩');
  });

  it('throws on invalid JSON schema (raw garbage)', async () => {
    // P0-4：完全无法解析的字符串（不是 JSON 也不是自然语言问题）→ 必须 throw
    mockAiChat.mockResolvedValueOnce({
      content: '你',
      provider: 'minimax',
      model: 'MiniMax-M3',
    });
    const iv = new Interviewer(makeCtx('byte'));
    await expect(iv.ask()).rejects.toThrow(/AI 输出非 JSON/);
  });

  it('parses JSON embedded in text (Phase 13.6 tolerant parser)', async () => {
    // Hy3 等小模型常输出 "好的，以下是 JSON：" + {valid JSON} + 后续解释
    mockAiChat.mockResolvedValueOnce({
      content:
        '好的，让我把它整理成 JSON：\n{"question":"讲讲 Redis 雪崩","dimension":"tech","phase":"deep"}\n希望对你有帮助。',
      provider: 'openrouter',
      model: 'tencent/hy3:free',
    });
    const iv = new Interviewer(makeCtx('byte'));
    const out = await iv.ask();
    expect(out.question).toBe('讲讲 Redis 雪崩');
  });

  it('parses JSON with leading explanation prefix', async () => {
    // Phase 13.6 容错：首段花括号平衡匹配
    mockAiChat.mockResolvedValueOnce({
      content:
        '以下是符合要求的输出：{"question":"你最有成就的项目？","dimension":"project","phase":"deep"}',
      provider: 'openrouter',
      model: 'google/gemma-4-26b-a4b-it:free',
    });
    const iv = new Interviewer(makeCtx('ali'));
    const out = await iv.ask();
    expect(out.question).toBe('你最有成就的项目？');
    expect(out.dimension).toBe('project');
  });
});

describe('PII guard', () => {
  it.each([
    ['你结婚了吗', 'byte'],
    ['你有几个孩子', 'ali'],
    ['你买房了吗', 'tencent'],
    ['你35岁了吗', 'bili'],
  ])('blocks PII question: %s (%s)', async (badQ, company) => {
    mockAiChat.mockResolvedValueOnce({
      content: JSON.stringify({ question: badQ, dimension: 'culture', phase: 'deep' }),
      provider: 'minimax',
      model: 'MiniMax-M3',
    });
    const iv = new Interviewer(makeCtx(company as InterviewerType));
    await expect(iv.ask()).rejects.toThrow(/PII 红线/);
  });
});
