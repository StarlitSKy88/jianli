/**
 * Test-helper gate — 统一管理 debug endpoint 的可见性
 *
 * 设计原则（基于 bug-019 经验固化）：
 * - 生产环境默认 OFF（避免误触探针泄露内部信息）
 * - 必须显式设置 ENABLE_TEST_HELPERS=1 才开放
 * - 所有 test-helper route 必须调 isTestHelpersEnabled() 短路
 *
 * 铁律（防回归）：
 * - ❌ 不要在生产环境长期保持 ENABLE_TEST_HELPERS=1
 * - ✅ 调试结束后立刻 EdgeOne 控制台删除 env var
 *
 * Phase 14.33.1 修正：去掉 NODE_ENV !== 'production' 限制。
 * 原因：原设计"三重保险"导致 prod 永远无法开启 debug
 *  → Phase 14.33 用户确认 ENABLE_TEST_HELPERS=1 已注入
 *  → 仍返回 404 是因为 NODE_ENV=production 把第二条短路了
 * 修订：env var 是**唯一**判断依据 + 文档化铁律要求用完立刻删
 */
export function isTestHelpersEnabled(): boolean {
  return process.env.ENABLE_TEST_HELPERS === '1';
}

/**
 * 调试场景统一错误：dev 返 404（对外部表现为"不存在"），avoid leaking existence
 */
export function testHelperDisabledResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
