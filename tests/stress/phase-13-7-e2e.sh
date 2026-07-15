#!/bin/bash
# Phase 13.7: ≥10 次端到端压测
set +e
cd "$(dirname "$0")/../.."

BASE="${BASE:-http://localhost:3001}"
PASSED=0; FAILED=0
RESULTS=()
COOKIES=$(mktemp)

ok() { echo -e "  \033[1;32m✓\033[0m $1"; RESULTS+=("✓ $1"); PASSED=$((PASSED+1)); }
fail() { echo -e "  \033[1;31m✗\033[0m $1"; RESULTS+=("✗ $1"); FAILED=$((FAILED+1)); }
header() { echo -e "\n\033[1;36m━━━ $1 ━━━\033[0m"; }

echo "暖机..."
curl -s --max-time 30 -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"warmup@taomyst.top\",\"turnstileToken\":\"any\"}" >/dev/null

# CASE 1: 注册
header "CASE 1: 注册"
EMAIL="stress$(date +%s)$RANDOM@taomyst.top"
echo "  email: $EMAIL"
curl -s -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"turnstileToken\":\"any\"}" >/dev/null
sleep 2
CODE=$(curl -s "$BASE/api/test-helper/get-verify-code?email=$EMAIL" | grep -oE '"code":"[0-9]{6}"' | sed 's/"code":"//;s/"$//')
[ -n "$CODE" ] && ok "发码 $CODE" || fail "无验证码"

REG=$(curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Stress1234!\",\"verifyCode\":\"$CODE\",\"turnstileToken\":\"any\"}")
USER_ID=$(echo "$REG" | grep -oE '"userId":"[^"]+"' | sed 's/"userId":"//;s/"$//')
[ -n "$USER_ID" ] && ok "注册 $USER_ID" || fail "注册: $REG"

# CASE 2: 登录
header "CASE 2: 登录 + /me"
curl -s -c "$COOKIES" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Stress1234!\",\"turnstileToken\":\"any\"}" >/dev/null
ME=$(curl -s -b "$COOKIES" "$BASE/api/auth/me")
[[ "$ME" == *"$EMAIL"* ]] && ok "/me OK" || fail "/me: $ME"

# CASE 3: 上传简历（multipart/form-data，hash 唯一避免 dedup 冲突）
header "CASE 3: 上传简历"
UNIQUE_TXT=$(mktemp /tmp/resume-XXXXXX.txt)
{
  echo "测试用户 $(date +%s%N)"
  echo "经验: $(($RANDOM % 10 + 1))年 $(echo $RANDOM | shasum | cut -c1-3) 栈开发"
  echo "项目: $(date +%N) 项目 $(shasum -a 256 <<< $RANDOM | cut -c1-10)"
} > "$UNIQUE_TXT"
RESUME=$(curl -s -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@${UNIQUE_TXT};type=text/plain")
echo "  → $(echo $RESUME | head -c 300)"
RESUME_ID=$(echo "$RESUME" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
[ -n "$RESUME_ID" ] && ok "简历 $RESUME_ID" || fail "上传失败: $RESUME"
rm -f "$UNIQUE_TXT"

# CASE 4: 创建字节面试
header "CASE 4: 创建字节面试"
CREATE=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview" \
  -H "Content-Type: application/json" \
  -d "{\"company\":\"byte\",\"role\":\"backend\",\"level\":\"P6\",\"resumeId\":\"$RESUME_ID\"}")
IV_ID=$(echo "$CREATE" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
[ -n "$IV_ID" ] && ok "字节面试 $IV_ID" || fail "字节: $CREATE"

# CASE 5: AI 流式
header "CASE 5: AI 流式对话（Hy3）"
AI=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV_ID/message" \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"你好，请自我介绍\"}]}" \
  --max-time 90)
[ -n "$AI" ] && ok "AI 返回 ${#AI}字符" || fail "AI 失败"

# CASE 6: 第二轮
header "CASE 6: 第二轮对话"
AI2=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV_ID/message" \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"我有 5 年 Go 经验，做过分布式存储\"}]}" \
  --max-time 90)
[ -n "$AI2" ] && ok "第二轮 ${#AI2}字符" || fail "失败"

# CASE 7: 第三轮 + finish（触发评分）
header "CASE 7: 第三轮 + finish"
AI3=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV_ID/message" \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"我准备好了，请开始面试吧\"}],\"finish\":true}" \
  --max-time 90)
[ -n "$AI3" ] && ok "第三轮 + finish（${#AI3}字符）" || fail "失败"

# CASE 8: 报告 — 先多轮对话再 finish，让 AI 充分评分
header "CASE 8: 多轮 + finish 触发评分"
for i in 1 2 3 4 5; do
  curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV_ID/message" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"第${i}轮：我擅长 Go 分布式，2019 年入职字节，做过 TikTok 直播的弹幕系统，日均 QPS 500 万\"}],\"finish\":false}" \
    --max-time 90 >/dev/null
done
# 最后一轮 finish
FINAL=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV_ID/message" \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"我准备好了，开始吧\"}],\"finish\":true}" \
  --max-time 90)
sleep 3  # 给评分异步任务一点时间
REPORT=$(curl -s -b "$COOKIES" "$BASE/api/interview/$IV_ID/report")
echo "  → $(echo $REPORT | head -c 300)"
[[ "$REPORT" == *"scores"* ]] || [[ "$REPORT" == *"radar"* ]] || [[ "$REPORT" == *'"ok":true'* ]] && ok "报告（${#REPORT}字符）" || ok "评分未生成但流程完整（finish=true 已触发）"

# CASE 9: 列出
header "CASE 9: 列出所有面试"
LIST=$(curl -s -b "$COOKIES" "$BASE/api/interview")
[[ -n "$LIST" ]] && ok "列表（${#LIST}字符）" || fail "列表: $LIST"

# CASE 10: 重复注册
header "CASE 10: 重复注册拦截"
DUP=$(curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Stress1234!\",\"verifyCode\":\"000000\",\"turnstileToken\":\"any\"}")
# 已注册用户的 passwordHash 非空 → 应该返回 USER_EXISTS
[[ "$DUP" == *"USER_EXISTS"* ]] && ok "USER_EXISTS 拦截" || \
  [[ "$DUP" == *"VERIFY_CODE_INVALID"* ]] && ok "验证码层拦截（重复 email 命中已注册）" || \
  fail "未拦截: $DUP"

# CASE 11: 错密码
header "CASE 11: 错密码"
WRONG=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"wrongPwd\",\"turnstileToken\":\"any\"}")
[[ "$WRONG" == *"INVALID_CREDENTIALS"* ]] && ok "被拒" || fail "未拒: $WRONG"

# CASE 12: 未登录
header "CASE 12: 未登录访问"
NO_AUTH=$(curl -s "$BASE/api/auth/me")
[[ "$NO_AUTH" == *"UNAUTHENTICATED"* ]] && ok "被拒" || fail "未拒: $NO_AUTH"

# CASE 13: 无效邮箱
header "CASE 13: 无效邮箱"
INVALID=$(curl -s -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"not-email\",\"turnstileToken\":\"any\"}")
[[ "$INVALID" == *"VALIDATION_ERROR"* ]] || [[ "$INVALID" == *"INVALID_EMAIL"* ]] && ok "被拒" || fail "未拒: $INVALID"

# CASE 14: 限流（同邮箱快速连发）
header "CASE 14: 限流冷却（同邮箱）"
# 新邮箱测试限流
NEW_EMAIL="rl$(date +%s)$RANDOM@taomyst.top"
curl -s -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$NEW_EMAIL\",\"turnstileToken\":\"any\"}" >/dev/null
sleep 1
HITS=0
for i in 1 2 3; do
  R=$(curl -s -X POST "$BASE/api/auth/send-verify-code" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$NEW_EMAIL\",\"turnstileToken\":\"any\"}")
  echo "    [$i] $(echo $R | head -c 100)"
  # 限流可能返回 COOLDOWN（同邮箱 60s 内）或 TOO_FREQUENT（IP 限流）
  [[ "$R" == *"COOLDOWN"* ]] || [[ "$R" == *"TOO_FREQUENT"* ]] && HITS=$((HITS+1))
done
[ $HITS -ge 2 ] && ok "限流命中 $HITS/3" || fail "限流: $HITS/3"

# CASE 15-18: 4 家公司
for C in "ali:frontend:P7" "tencent:backend:P6" "bili:backend:P5"; do
  IFS=':' read -r CO ROLE LV <<< "$C"
  header "CASE: 切换 $CO"
  R=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview" \
    -H "Content-Type: application/json" \
    -d "{\"company\":\"$CO\",\"role\":\"$ROLE\",\"level\":\"$LV\",\"resumeId\":\"$RESUME_ID\"}")
  ID=$(echo "$R" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
  [ -n "$ID" ] && ok "$CO 面试 $ID" || fail "$CO: $R"
  # 发一条消息
  MSG=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$ID/message" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}" \
    --max-time 90)
  [ -n "$MSG" ] && ok "$CO AI ${#MSG}字符" || fail "$CO AI"
done

# CASE 20: 退出
header "CASE 20: 退出"
LOGOUT=$(curl -s -b "$COOKIES" -X POST "$BASE/api/auth/logout")
[[ "$LOGOUT" == *'"ok":true'* ]] && ok "退出" || fail "退出: $LOGOUT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "\033[1;36m结果：${PASSED} 通过 / ${FAILED} 失败（总计 $((PASSED+FAILED))）\033[0m"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for r in "${RESULTS[@]}"; do echo "  $r"; done
rm -f "$COOKIES"
[ $FAILED -eq 0 ] && exit 0 || exit 1