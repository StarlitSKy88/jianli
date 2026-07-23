/**
 * POST /api/interview/[id]/message — 流式 SSE
 *
 * 入参：{ messages: [{role, content}], finish?: boolean }
 * 出参：SSE 流
 *   data: {"content":"你"}\n\n
 *   ...
 *   data: [DONE]\n\n
 *
 * 流程：
 *  1. 鉴权 + ownership 校验
 *  2. 限流（服务端基于 User.paidQuota，单事务内 decrement；不接 client isPaid）
 *  3. 持久化 user message
 *  4. 构造 Interviewer → ask()（复用 lib/agents/interviewer，ai-router 已带并发限流）
 *  5. 持久化 assistant message
 *  6. 流式输出（SSE）
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { getSession, errorResponse, validationErrorResponse } from '@/lib/auth/middleware';
import { checkLimit } from '@/lib/utils/rate-limit';
import { Interviewer, type InterviewerType } from '@/lib/agents/interviewer';
import { track } from '@/lib/analytics/track';
import { DIMENSION_WEIGHTS } from '@/lib/scoring/dimensions';
import { saveReport } from '@/lib/scoring/persist';
import { scoreOne } from '@/lib/scoring/scorer';
import { aggregate } from '@/lib/scoring/aggregator';

/**
 * Round 9 Bug-R8A-1 修复：finish 评分路径独立函数
 *
 * 关键设计决策：把它从 ReadableStream.start() 的 try 块里移出
 * - 原问题：client 在 finish=true 时早断 → ReadableStream start() 内后续 await 会被 AbortSignal 串 cancel
 * - 修法：fire-and-forget，不 await，让它在 SSE 流生命周期外独立完成
 * - 兜底：调用方有 .catch() 捕获意外失败
 *
 * 为什么不用 ReadableStream.cancel(reason) 钩子？
 * - cancel 只在 client disconnect 时触发，正常完成时不触发 → finish 路径分裂两处，难维护
 * - fire-and-forget 单一路径，覆盖所有 finish=true 场景
 */
async function runFinishPipeline(args: {
  interviewId: string;
  userId: string;
  company: InterviewerType;
  scenarioCompany: string;
  role: string;
  level: string;
  scenarioWeights: Record<string, number>;
  windowedMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<void> {
  const {
    interviewId,
    userId,
    company,
    scenarioCompany,
    role,
    level,
    scenarioWeights,
    windowedMessages,
  } = args;

  await prisma.interview.update({
    where: { id: interviewId },
    data: { status: 'COMPLETED', endedAt: new Date() },
  });
  track(userId, 'interview_completed', { interviewId });

  const dims = (Object.keys(scenarioWeights) as Array<keyof typeof DIMENSION_WEIGHTS.byte>).filter(
    (d) => scenarioWeights[d] > 0
  );

  // P0-2 修复：Promise.all 并发评分（aiChat 内部已 withLLMSlot 全局并发限流）
  const scoreEntries = await Promise.all(
    dims.map(async (dim) => {
      const score = await scoreOne({
        company,
        role,
        level,
        dimension: dim,
        transcript: windowedMessages,
      });
      return [dim as string, score] as const;
    })
  );
  const scores = Object.fromEntries(scoreEntries);

  const report = aggregate({ company, scores });
  await saveReport({
    interviewId,
    userId,
    company: scenarioCompany,
    scores,
    aggregated: report,
  });
  await prisma.interview.update({
    where: { id: interviewId },
    data: { totalScore: report.totalScore },
  });
}

// P0-2 修复：把硬上限 .max(50) 改为 .max(100)，并在解析后做滑动窗口截断
// 原因：30 轮对话 = 60 条 user+assistant，硬 50 让 round 26 之后被 400 拒
// 滑动窗口：保留 system 等价 + 最近 N 条 user/assistant 对，N=40 留余量
const HISTORY_WINDOW = 40;

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(100), // 放宽到 100，让滑动窗口有空间裁剪
  finish: z.boolean().optional(),
});

const encoder = new TextEncoder();

function sseEvent(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function sseDone(): Uint8Array {
  return encoder.encode(`data: [DONE]\n\n`);
}

/** Round 7 Bug-010 修复:在 SSE 帧里发业务状态(success/error)替代不可变的 x-biz-status header。
 *  永远在 [DONE] 之前发,客户端用 addEventListener('message', ...) 读 event.data.bizStatus 即可。 */
function sseBizStatus(status: 'success' | 'error'): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ bizStatus: status })}\n\n`);
}

/** 15s heartbeat（防 proxy idle timeout / 中途断连） */
const HEARTBEAT_MS = 15_000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return validationErrorResponse(body.error);

  // P0-2 修复：滑动窗口截断 history。
  // 30 轮对话 = 60 条 user/assistant，原 .max(50) 让 round 26 起全 400，finish 永远进不来。
  // 策略：保留最后一对 user/assistant 完整对话 + 之前的滚动窗口（最多 40 条 = 20 轮）
  // 这样：(1) finish=true 永不因超 50 被拒 (2) AI 仍能拿到最近 20 轮上下文
  const rawMessages = body.data.messages;
  const windowedMessages =
    rawMessages.length <= HISTORY_WINDOW ? rawMessages : rawMessages.slice(-HISTORY_WINDOW);

  const interview = await prisma.interview.findUnique({
    where: { id: params.id },
    include: { scenario: true, resume: true },
  });
  if (!interview) return errorResponse('INTERVIEW_NOT_FOUND', '面试不存在', 404);
  if (interview.userId !== session.userId)
    return errorResponse('FORBIDDEN', '无权访问他人面试', 403);
  if (interview.status !== 'IN_PROGRESS')
    return errorResponse('INTERVIEW_ENDED', '面试已结束', 400);

  // 服务端限流（不接 client isPaid — 服务端查 User.paidQuota 决定）
  const rl = await checkLimit(session.userId, 'message');
  if (!rl.allowed) {
    const resetISO = rl.resetAt.toISOString();
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: '今日免费额度已用完，请付费 ¥9.9 继续',
          remaining: rl.remaining,
          resetAt: resetISO,
        },
      },
      { status: 429 }
    );
  }

  // 持久化 user message（P0-2：用 windowed 后的最后一条）
  const lastUser = windowedMessages[windowedMessages.length - 1];
  await prisma.message.create({
    data: {
      interviewId: interview.id,
      role: 'USER',
      content: lastUser.content,
    },
  });
  track(session.userId, 'message_sent', { interviewId: interview.id });

  const company = interview.scenario.company as InterviewerType;
  const scenarioWeights = DIMENSION_WEIGHTS[company];

  // Round 9 Bug-R8A-1 修复：把 finish 评分路径移出 ReadableStream.start() 的 try 块
  // 原因：client abort → ReadableStream start() 内后续 await 会被 AbortSignal 串 cancel
  //       → finish 评分(5 await)整链路丢失 → status=IN_PROGRESS, 用户金钱丢失
  // 解法：fire-and-forget 拆出独立 Promise，不 await，让它在 SSE 流生命周期外独立完成
  //       .catch 兜底：即使 finish 自身失败也不影响 SSE 主流程
  if (body.data.finish) {
    void runFinishPipeline({
      interviewId: interview.id,
      userId: session.userId,
      company,
      scenarioCompany: interview.scenario.company,
      role: interview.scenario.role,
      level: interview.scenario.level,
      scenarioWeights,
      windowedMessages,
    }).catch((e) => {
      console.error('[finish-pipeline] unexpected failure', {
        interviewId: interview.id,
        userId: session.userId,
        errorMessage: (e as Error).message,
      });
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      try {
        // SSE heartbeat — 防 proxy idle timeout
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            /* stream 已关闭 */
          }
        }, HEARTBEAT_MS);

        const interviewer = new Interviewer({
          userId: session.userId,
          scenarioId: interview.scenarioId,
          company,
          role: interview.scenario.role,
          level: interview.scenario.level,
          resume: {
            name: interview.resume.name || 'anonymous',
            yearsOfExperience: interview.resume.yearsOfExperience || 0,
            skills: Array.isArray(interview.resume.techStack)
              ? (interview.resume.techStack as string[])
              : [],
            projects: Array.isArray((interview.resume.parsed as { projects?: unknown[] })?.projects)
              ? (
                  interview.resume.parsed as {
                    projects: Array<{ name?: string; description?: string; techStack?: string[] }>;
                  }
                ).projects.map((p) => ({
                  name: p.name || 'unknown',
                  duration: '',
                  description: p.description || '',
                  techStack: Array.isArray(p.techStack) ? p.techStack : [],
                }))
              : [],
          },
          history: windowedMessages, // P0-2：滑动窗口后传给 AI（含 user 真实回答 + 最近 assistant 回复）
        });

        const out = await interviewer.ask();
        controller.enqueue(
          sseEvent({ content: out.question, dimension: out.dimension, phase: out.phase })
        );

        // 持久化 assistant
        await prisma.message.create({
          data: {
            interviewId: interview.id,
            role: 'INTERVIEWER',
            content: out.question,
          },
        });

        // Round 9 修复：finish 评分路径已移出 start() 之外作为独立 fire-and-forget 任务
        // 这里不再处理 finish 逻辑（见 runFinishPipeline() + 上方 void 调用）

        // Round 7 Bug-010 修复:业务状态通过 SSE event 携带(替代不可变 header)
        controller.enqueue(sseBizStatus('success'));
        controller.enqueue(sseDone());
      } catch (e) {
        // P0-3 修复：结构化日志，让监控/告警能基于此聚合"业务失败率"
        // 而非只看 HTTP 200（HTTP 200 在 SSE 下永远成立）
        console.error('[interview-message] STREAM_ERROR', {
          interviewId: interview.id,
          userId: session.userId,
          errorMessage: (e as Error).message,
          errorStack: (e as Error).stack?.split('\n').slice(0, 5).join('\n'),
          timestamp: new Date().toISOString(),
        });
        controller.enqueue(
          sseEvent({ error: { code: 'STREAM_ERROR', message: (e as Error).message } })
        );
        // Round 7 Bug-010 修复:错误路径也发 bizStatus=error
        controller.enqueue(sseBizStatus('error'));
        controller.enqueue(sseDone());
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // 防中间代理 buffer
      'x-accel-buffering': 'no',
      // 业务状态改用 SSE event 携带 ({bizStatus: success/error})：
      // HTTP header 一旦发送就不可变 (HTTP/1.1 §7),之前 x-biz-status: pending 永远不会被更新。
      // Round 7 Bug-010 修复：移除不可靠的 header,把业务状态挪到 SSE 数据帧。
    },
  });
}
