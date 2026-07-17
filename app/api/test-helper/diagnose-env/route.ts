/**
 * /api/test-helper/diagnose-env — Phase 15.5-B10 诊断端点
 *
 * 用途：当用户说 env 已注入但 health 显示未启用时，直接打印 runtime
 * process.env 实际值（脱敏后 8 字符前缀）。
 *
 * 安全：
 * - 仅 ENABLE_TEST_HELPERS=1 时生效（prod 默认 404）
 * - 只输出 key 前 8 字符 + 长度 + 末尾 4 字符，不暴露完整 secret
 */
import { NextResponse } from 'next/server';
import { isTestHelpersEnabled, testHelperDisabledResponse } from '@/lib/test-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isTestHelpersEnabled()) return testHelperDisabledResponse();

  // 关心的 env keys（按优先级）
  const KEYS = [
    'OPENROUTER_API_KEY',
    'OPENROUTER_MODEL',
    'OPENROUTER_FALLBACK_MODELS',
    'MINIMAX_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'DEEPSEEK_API_KEY',
    'USE_MOCK_AI',
    'DISABLE_TURNSTILE',
    'ENABLE_TEST_HELPERS',
    'NODE_ENV',
  ];

  const report: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = process.env[k];
    if (v === undefined) {
      report[k] = { present: false };
    } else {
      report[k] = {
        present: true,
        length: v.length,
        prefix: v.slice(0, 8),
        suffix: v.slice(-4),
        looksLikePlaceholder: /^(undefined|null|your-?key|placeholder|xxx+|\*+)$/i.test(v),
      };
    }
  }

  return NextResponse.json({
    ok: true,
    envAtRuntime: report,
    ts: new Date().toISOString(),
  });
}
