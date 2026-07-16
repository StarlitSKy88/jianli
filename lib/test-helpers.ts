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
 * - ❌ 不要用 NODE_ENV === 'production' 作为唯一条件（CLI/Edge 注入可能不设）
 * - ✅ 调试结束后立刻 EdgeOne 控制台删除 env var
 */
export function isTestHelpersEnabled(): boolean {
  // 三重保险：env 显式开启 AND 不是强制 production
  return process.env.ENABLE_TEST_HELPERS === '1' && process.env.NODE_ENV !== 'production';
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
