#!/bin/bash
# 边界 + 异常路径原子级测试
# 10 个边界场景,每个独立可验证
#
# 用法: bash tests/stress/boundary-tests.sh
set +e
cd "$(dirname "$0")/../.."

BASE="${BASE:-http://localhost:3001}"
TS=$(date +%s)
RAND=$RANDOM

ok() { echo -e "  \033[1;32m✓\033[0m $1"; }
fail() { echo -e "  \033[1;31m✗\033[0m $1"; printf '%d' $(($(cat $ERRORS_FILE)+1)) > $ERRORS_FILE; }
section() { echo -e "\n\033[1;36m━━━ $1 ━━━\033[0m"; }
ERRORS_FILE=$(mktemp); echo "0" > $ERRORS_FILE

# 工具函数:发码 + 注册 + 拿 cookie(返回 cookie 文件路径)
register_user() {
  local email="$1"
  local password="${2:-Test1234!}"
  local cookies="/tmp/bnd-cookies-$TS-$RANDOM-$RANDOM.txt"
  curl -s -m 5 -X POST "$BASE/api/auth/send-verify-code" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"turnstileToken\":\"any\"}" > /dev/null
  sleep 2
  local code=$(curl -s -m 5 "$BASE/api/test-helper/get-verify-code?email=$email" | grep -oE '"code":"[0-9]{6}"' | sed 's/"code":"//;s/"$//')
  if [ -z "$code" ]; then echo "$cookies"; return 1; fi
  curl -s -m 10 -c "$cookies" -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"verifyCode\":\"$code\",\"turnstileToken\":\"any\"}" > /dev/null
  echo "$cookies"
}

# ============================================
section "E1: 重复注册同 email 应返回 409 EMAIL_TAKEN"
EMAIL="bnd-e1-$TS-$RAND@taomyst.top"
register_user "$EMAIL" > /dev/null
R=$(curl -s -m 10 -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!\",\"verifyCode\":\"123456\",\"turnstileToken\":\"any\"}" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "409" ] && echo "$CODE" | grep -q "EMAIL_TAKEN" && ok "E1 ✅ 409 EMAIL_TAKEN" || fail "E1 ❌ HTTP=$HTTP $CODE (期望 409 EMAIL_TAKEN)"

# ============================================
section "E2: 错误密码应返回 401 INVALID_PASSWORD"
EMAIL="bnd-e2-$TS-$RAND@taomyst.top"
register_user "$EMAIL" > /dev/null
R=$(curl -s -m 10 -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"WrongPassword!\",\"turnstileToken\":\"any\"}" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "401" ] && echo "$CODE" | grep -qE "INVALID_CREDENTIALS|INVALID_PASSWORD|UNAUTHENTICATED" && ok "E2 ✅ 401 ($CODE)" || fail "E2 ❌ HTTP=$HTTP $CODE (期望 401)"

# ============================================
section "E3: 错误验证码应返回 400 VERIFY_CODE_INVALID"
EMAIL="bnd-e3-$TS-$RAND@taomyst.top"
curl -s -m 5 -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"turnstileToken\":\"any\"}" > /dev/null
sleep 2
R=$(curl -s -m 10 -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!\",\"verifyCode\":\"000000\",\"turnstileToken\":\"any\"}" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "400" ] && echo "$CODE" | grep -q "VERIFY_CODE" && ok "E3 ✅ 400 VERIFY_CODE_*" || fail "E3 ❌ HTTP=$HTTP $CODE (期望 400 VERIFY_CODE_*)"

# ============================================
section "E4: 跨用户访问别人的面试应返回 403"
EMAIL_A="bnd-e4a-$TS-$RAND@taomyst.top"
EMAIL_B="bnd-e4b-$TS-$RAND@taomyst.top"
COOKIES_A=$(register_user "$EMAIL_A")
COOKIES_B=$(register_user "$EMAIL_B")
# A 上传简历 + 创建面试
echo "test resume" > /tmp/bnd-resume-$TS.txt
RESUME_ID=$(curl -s -m 30 -b "$COOKIES_A" -X POST "$BASE/api/resume/upload" \
  -F "file=@/tmp/bnd-resume-$TS.txt;type=text/plain" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
INTERVIEW_ID=$(curl -s -m 10 -b "$COOKIES_A" -X POST "$BASE/api/interview" \
  -H "Content-Type: application/json" \
  -d "{\"company\":\"byte\",\"role\":\"后端工程师\",\"level\":\"P6\",\"resumeId\":\"$RESUME_ID\"}" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
echo "  A 的 interview: $INTERVIEW_ID"
# B 尝试访问 A 的面试
R=$(curl -s -m 10 -b "$COOKIES_B" "$BASE/api/interview/$INTERVIEW_ID" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  B GET → HTTP=$HTTP  $CODE"
[ "$HTTP" = "403" ] || [ "$HTTP" = "404" ] && ok "E4 ✅ HTTP=$HTTP(隔离正确)" || fail "E4 ❌ HTTP=$HTTP $CODE (期望 403/404)"

# ============================================
section "E5: 6MB 简历上传应返回 413/400"
EMAIL="bnd-e5-$TS-$RAND@taomyst.top"
COOKIES=$(register_user "$EMAIL")
dd if=/dev/zero of=/tmp/bnd-large-$TS.txt bs=1M count=6 2>/dev/null
R=$(curl -s -m 60 -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@/tmp/bnd-large-$TS.txt;type=text/plain" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "413" ] || [ "$HTTP" = "400" ] && ok "E5 ✅ HTTP=$HTTP(拦截)" || fail "E5 ❌ HTTP=$HTTP $CODE (期望 413/400)"
rm -f /tmp/bnd-large-$TS.txt

# ============================================
section "E6: 上传 .exe 应返回 415/400"
EMAIL="bnd-e6-$TS-$RAND@taomyst.top"
COOKIES=$(register_user "$EMAIL")
printf 'MZ\x90\x00\x03\x00\x00\x00' > /tmp/bnd-evil-$TS.exe
R=$(curl -s -m 10 -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@/tmp/bnd-evil-$TS.exe;type=application/octet-stream" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "415" ] || [ "$HTTP" = "400" ] && ok "E6 ✅ HTTP=$HTTP(拦截)" || fail "E6 ❌ HTTP=$HTTP $CODE (期望 415/400)"
rm -f /tmp/bnd-evil-$TS.exe

# ============================================
section "E7: 邮箱格式无效应返回 400 VALIDATION_ERROR"
R=$(curl -s -m 10 -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"not-an-email\",\"password\":\"Test1234!\",\"verifyCode\":\"123456\",\"turnstileToken\":\"any\"}" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "400" ] && echo "$CODE" | grep -q "VALIDATION" && ok "E7 ✅ 400 VALIDATION_ERROR" || fail "E7 ❌ HTTP=$HTTP $CODE (期望 400 VALIDATION_ERROR)"

# ============================================
section "E8: 密码 < 8 位应返回 400 VALIDATION_ERROR"
R=$(curl -s -m 10 -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"e8-$TS-$RAND@taomyst.top\",\"password\":\"123\",\"verifyCode\":\"123456\",\"turnstileToken\":\"any\"}" \
  -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "400" ] && echo "$CODE" | grep -q "VALIDATION" && ok "E8 ✅ 400 VALIDATION_ERROR" || fail "E8 ❌ HTTP=$HTTP $CODE (期望 400 VALIDATION_ERROR)"

# ============================================
section "E9: 无效 JWT 应返回 401 UNAUTHENTICATED"
R=$(curl -s -m 10 -H "Cookie: auth=invalid.jwt.token" "$BASE/api/auth/me" -w "\n__HTTP__:%{http_code}")
HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
CODE=$(echo "$R" | grep -oE '"code":"[^"]+"' | head -1)
echo "  HTTP=$HTTP  $CODE"
[ "$HTTP" = "401" ] && ok "E9 ✅ 401" || fail "E9 ❌ HTTP=$HTTP $CODE (期望 401)"

# ============================================
section "E10: 同简历 2 次上传应去重"
EMAIL="bnd-e10-$TS-$RAND@taomyst.top"
COOKIES=$(register_user "$EMAIL")
echo "duplicate resume content $(date)" > /tmp/bnd-dup-$TS.txt
R1=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@/tmp/bnd-dup-$TS.txt;type=text/plain")
ID1=$(echo "$R1" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
R2=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@/tmp/bnd-dup-$TS.txt;type=text/plain")
ID2=$(echo "$R2" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
echo "  ID1=$ID1  ID2=$ID2"
[ "$ID1" = "$ID2" ] && [ -n "$ID1" ] && ok "E10 ✅ 去重: ID1==ID2" || fail "E10 ❌ ID1=$ID1 ID2=$ID2 (应相同)"
rm -f /tmp/bnd-dup-$TS.txt /tmp/bnd-resume-$TS.txt

# ============================================
section "总结"
ERRORS=$(cat $ERRORS_FILE)
rm -f $ERRORS_FILE
if [ $ERRORS -eq 0 ]; then
  echo -e "\n  \033[1;32m✅ 10/10 边界全部通过\033[0m"
  exit 0
else
  echo -e "\n  \033[1;31m❌ $ERRORS 个边界失败\033[0m"
  exit 1
fi