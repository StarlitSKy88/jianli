/**
 * 全局 LLM 并发限流（minimax 默认 RPM 触发 429 → 雪崩 → 必须限流）
 *
 * 用最简单的令牌桶 / 信号量：同一时刻最多 N 个 LLM 调用 in-flight。
 * 不依赖 p-limit 等三方库 — 单文件、零依赖、可测试。
 *
 * 使用：
 *   const release = await acquireLLMSlot();
 *   try { return await aiChat(...); } finally { release(); }
 *
 * 或：withLLMSlot(() => aiChat(...))
 */
const MAX_CONCURRENT = Number(process.env.LLM_MAX_CONCURRENT ?? 8);

let inFlight = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      inFlight++;
      resolve();
    });
  });
}

function release(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

export async function withLLMSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function acquireLLMSlot(): Promise<() => void> {
  await acquire();
  return release;
}

export function llmStats(): { inFlight: number; queued: number; max: number } {
  return { inFlight, queued: waiters.length, max: MAX_CONCURRENT };
}
