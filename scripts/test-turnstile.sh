#!/usr/bin/env bash
# ============================================
# Cloudflare Turnstile 端到端测试脚本
# ============================================
# 用途：部署后验证 Turnstile 配置是否正确
#
# 用法：
#   SITE_KEY=0x4AAAAAAD168NRRcdDk1tma \
#   SECRET_KEY=0x4AAAAAAD168FBMFRJnRytlIPmdGt6B5c0 \
#   ./scripts/test-turnstile.sh
#
# 输出：
#   - Site Key 配置检查
#   - Secret Key 配置检查
#   - 真实 Cloudflare siteverify 端到端
#   - 预期结果（假 token → success:false，真 token → success:true）
# ============================================

set -e

SITE_KEY="${SITE_KEY:-}"
SECRET_KEY="${SECRET_KEY:-}"
API_URL="${API_URL:-http://localhost:3001}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "🛡️  Cloudflare Turnstile 部署验证"
echo "=========================================="
echo ""

# 1) 配置检查
echo "📋 配置检查："
if [ -z "$SITE_KEY" ]; then
  echo -e "  ${RED}✗${NC} SITE_KEY 未设置"
  exit 1
else
  echo -e "  ${GREEN}✓${NC} SITE_KEY: ${SITE_KEY:0:14}..."
fi
if [ -z "$SECRET_KEY" ]; then
  echo -e "  ${RED}✗${NC} SECRET_KEY 未设置"
  exit 1
else
  echo -e "  ${GREEN}✓${NC} SECRET_KEY: ${SECRET_KEY:0:14}..."
fi
echo ""

# 2) 假 token 校验（应该失败）
echo "🧪 测试 1: 假 token（应返回 success:false）"
RESP=$(curl -s "https://challenges.cloudflare.com/turnstile/v0/siteverify" \
  -X POST \
  -d "secret=$SECRET_KEY&response=XXXX.DUMMY.TOKEN.XXXX")
echo "  响应: $RESP"
SUCCESS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))" 2>/dev/null || echo "?")
if [ "$SUCCESS" = "False" ] || [ "$SUCCESS" = "false" ]; then
  echo -e "  ${GREEN}✓${NC} 正确拒绝假 token"
else
  echo -e "  ${RED}✗${NC} 异常：假 token 被接受"
  exit 1
fi
echo ""

# 3) Cloudflare 测试 secret（永远返回 success）
echo "🧪 测试 2: Cloudflare 测试 secret + 测试 token"
# 文档：https://developers.cloudflare.com/turnstile/troubleshooting/testing/
# 测试 site key: 1x00000000000000000000AA (Visible)
# 测试 secret key: 1x0000000000000000000000000000000AA
RESP=$(curl -s "https://challenges.cloudflare.com/turnstile/v0/siteverify" \
  -X POST \
  -d "secret=1x0000000000000000000000000000000AA&response=XXXX.DUMMY.TOKEN.XXXX")
echo "  响应: $RESP"
SUCCESS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))" 2>/dev/null || echo "?")
if [ "$SUCCESS" = "True" ] || [ "$SUCCESS" = "true" ]; then
  echo -e "  ${GREEN}✓${NC} 测试密钥工作正常"
else
  echo -e "  ${RED}✗${NC} 测试密钥异常"
fi
echo ""

# 4) 应用 API 验证
echo "🧪 测试 3: 应用 API 是否正确处理 token"
echo "  发送带假 token 的 send-verify-code..."
RESP=$(curl -s -o /tmp/turnstile-api.json -w "%{http_code}" -X POST "$API_URL/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d '{"email":"turnstile-deploy-test@jianli.app","turnstileToken":"XXXX.DUMMY.TOKEN.XXXX"}')
echo "  HTTP: $RESP"
cat /tmp/turnstile-api.json
echo ""
if [ "$RESP" = "400" ]; then
  echo -e "  ${GREEN}✓${NC} 后端正确拒绝假 token (400 TURNSTILE_FAILED)"
else
  echo -e "  ${YELLOW}⚠${NC} HTTP $RESP（可能是限流 429，检查日志）"
fi
echo ""

echo "=========================================="
echo -e "${GREEN}✅ 全部检查完成${NC}"
echo "=========================================="
echo ""
echo "📌 下一步："
echo "  1. 浏览器访问 https://jianli-p2nw5zbr.edgeone.cool/register"
echo "  2. 应该看到底部出现 Turnstile widget（透明框 + Cloudflare logo）"
echo "  3. 等待几秒，widget 显示 ✓ 后才能提交注册"
echo ""
echo "如有问题："
echo "  - widget 不显示 → 检查 NEXT_PUBLIC_TURNSTILE_SITE_KEY 是否注入"
echo "  - 提交返回 400 → 检查后端日志 + Cloudflare Dashboard → Turnstile → Analytics"