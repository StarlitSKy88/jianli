#!/bin/bash
# Mock 真实用户：完整用户旅程
# 1. 注册 (send-code → register → login)
# 2. 上传简历
# 3. 创建面试
# 4. 多轮对话 (流式 SSE)
# 5. 完成面试 + 触发评分
# 6. 查看评分报告
# 7. 付费（mock）
# 8. 提交反馈
#
# 用法: bash tests/stress/mock-user-e2e.sh <company> <level> <role>
set +e
cd "$(dirname "$0")/../.."

COMPANY="${1:-byte}"
LEVEL="${2:-P6}"
ROLE="${3:-后端工程师}"
BASE="${BASE:-http://localhost:3001}"

EMAIL="e2e-${COMPANY}-${LEVEL}-$(date +%s)-$RANDOM@taomyst.top"
PASS="Test1234!"
COOKIES="/tmp/mock-user-cookies-$$.txt"
RES_DIR="/tmp/mock-user-$$"
mkdir -p "$RES_DIR"

ok() { echo -e "  \033[1;32m✓\033[0m $1"; }
fail() { echo -e "  \033[1;31m✗\033[0m $1"; printf '%d' $(($(cat $ERRORS_FILE)+1)) > $ERRORS_FILE; }
warn() { echo -e "  \033[1;33m⚠\033[0m $1"; }
section() { echo -e "\n\033[1;36m━━━ $1 ━━━\033[0m"; }
ERRORS_FILE=$(mktemp); echo "0" > $ERRORS_FILE

section "用户 $EMAIL ($COMPANY/$LEVEL/$ROLE)"

# 1.1 发验证码
section "1. 注册流程"
R=$(curl -s -m 30 -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"turnstileToken\":\"any\"}")
echo "  send-verify-code: $R"
sleep 2

# 1.2 拿验证码 (dev only)
CODE=$(curl -s -m 5 "$BASE/api/test-helper/get-verify-code?email=$EMAIL" | grep -oE '"code":"[0-9]{6}"' | sed 's/"code":"//;s/"$//')
[ -n "$CODE" ] && ok "验证码: $CODE" || fail "拿不到验证码"

# 1.3 注册
R=$(curl -s -m 30 -c "$COOKIES" -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"verifyCode\":\"$CODE\",\"turnstileToken\":\"any\"}")
echo "  register: $R" | head -c 200; echo
echo "$R" | grep -q '"ok":true' && ok "注册成功" || fail "注册失败: $R"

# 1.4 /me
ME=$(curl -s -m 10 -b "$COOKIES" "$BASE/api/auth/me")
echo "  /me: $ME"
echo "$ME" | grep -iq "\"email\":\"$EMAIL\"" && ok "/me 正确" || fail "/me 错误: $ME"

# 2. 上传简历
section "2. 上传简历"
cat > "$RES_DIR/resume.txt" <<EOF
用户 ${EMAIL} 的简历
职位: $ROLE
职级: $LEVEL
公司: $COMPANY
经验: $((RANDOM % 10 + 2)) 年
技术栈: Redis, Kafka, MySQL, Docker, K8s, Java, Go, Python
项目: 高并发订单系统 (QPS 50w), 分布式调度平台, 推荐系统
EOF

R=$(curl -s -m 60 -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@${RES_DIR}/resume.txt;type=text/plain")
echo "  upload: $R" | head -c 300; echo
RESUME_ID=$(echo "$R" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
[ -n "$RESUME_ID" ] && ok "简历 ID: $RESUME_ID" || fail "简历上传失败: $R"

# 3. 创建面试
section "3. 创建面试 ($COMPANY/$LEVEL/$ROLE)"
R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/interview" \
  -H "Content-Type: application/json" \
  -d "{\"company\":\"$COMPANY\",\"role\":\"$ROLE\",\"level\":\"$LEVEL\",\"resumeId\":\"$RESUME_ID\"}")
echo "  create: $R" | head -c 300; echo
INTERVIEW_ID=$(echo "$R" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
[ -n "$INTERVIEW_ID" ] && ok "面试 ID: $INTERVIEW_ID" || fail "面试创建失败: $R"

# 4. 多轮对话
section "4. 面试对话 (5 轮)"
for round in 1 2 3 4 5; do
  R=$(curl -s -m 60 -b "$COOKIES" -X POST "$BASE/api/interview/$INTERVIEW_ID/message" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"这是第 $round 轮回答。请针对我的项目经验给出下一个问题。\"}],\"finish\":false}" \
    -w "\n__CURL_HTTP__:%{http_code} __CURL_TIME__:%{time_total}\n")
  # 只抓 curl -w 注入的标记（SSE body 里可能含 "HTTP:" / "TIME:" 字样会污染）
  HTTP=$(echo "$R" | grep -oE '__CURL_HTTP__:[0-9]+' | head -1 | sed 's/__CURL_HTTP__://')
  TIME=$(echo "$R" | grep -oE '__CURL_TIME__:[0-9.]+' | head -1 | sed 's/__CURL_TIME__://')
  LEN=$(echo -n "$R" | wc -c)
  echo "  Round $round: HTTP=$HTTP TIME=${TIME}s LEN=${LEN}字节"
  case "$HTTP" in
    200) ok "Round $round 200 (${TIME}s)" ;;
    429) warn "Round $round HTTP=429（free quota 用尽，符合预期）" ;;
    *) fail "Round $round HTTP=$HTTP" ;;
  esac
  sleep 1
done

# 5. 完成面试 + 触发评分
section "5. 完成面试 + 评分"
R=$(curl -s -m 120 -b "$COOKIES" -X POST "$BASE/api/interview/$INTERVIEW_ID/complete")
echo "  complete: $R" | head -c 400; echo
echo "$R" | grep -q '"ok":true' && ok "完成成功" || fail "完成失败"

# 6. 看报告
section "6. 评分报告"
sleep 5  # 等评分写入完成
R=$(curl -s -m 30 -b "$COOKIES" "$BASE/api/interview/$INTERVIEW_ID/report")
echo "  report (前400字): $(echo "$R" | head -c 400)"
echo "$R" | grep -q '"totalScore"' && ok "报告有 totalScore" || fail "报告缺 totalScore"

# 7. 付费
section "7. 付费 (mock)"
R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/payment" \
  -H "Content-Type: application/json" -d '{"quantity":1}')
echo "  create: $R" | head -c 300; echo
PAY_ID=$(echo "$R" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
[ -n "$PAY_ID" ] && ok "Payment ID: $PAY_ID" || fail "支付订单创建失败"

R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/payment/$PAY_ID/confirm")
echo "  confirm: $R" | head -c 200; echo
echo "$R" | grep -q '"granted":1' && ok "付费成功 granted=1" || fail "付费失败: $R"

# 8. 反馈
section "8. 提交反馈"
R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{"category":"FEATURE","content":"整体体验不错，希望增加更多公司","contactEmail":"'$EMAIL'","website":"","company_name":"","phone_number":""}')
echo "  feedback: $R" | head -c 200; echo
echo "$R" | grep -q '"ok":true' && ok "反馈提交" || fail "反馈失败: $R"

# 9. 登出
section "9. 登出"
R=$(curl -s -m 10 -b "$COOKIES" -X POST "$BASE/api/auth/logout")
echo "$R" | grep -q '"ok":true' && ok "登出成功" || fail "登出失败: $R"

section "总结"
ERRORS=$(cat $ERRORS_FILE)
rm -f $ERRORS_FILE
if [ $ERRORS -eq 0 ]; then
  echo -e "\n  \033[1;32m✅ $EMAIL 全部通过 (0 errors)\033[0m"
  rm -rf "$RES_DIR" "$COOKIES"
  exit 0
else
  echo -e "\n  \033[1;31m❌ $EMAIL 出现 $ERRORS 个错误\033[0m"
  exit 1
fi