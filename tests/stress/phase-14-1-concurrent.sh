#!/bin/bash
# Phase 14.1: 10 个用户并发面试压测（最终修复版）
set +e
cd "$(dirname "$0")/../.."

BASE="${BASE:-http://localhost:3001}"
N=${N:-10}
COOKIES_DIR="/tmp/stress14.1-$$"
RESULTS_DIR="/tmp/stress14.1-r-$$"
mkdir -p "$COOKIES_DIR" "$RESULTS_DIR"

ok() { echo -e "  \033[1;32m✓\033[0m $1"; }
fail() { echo -e "  \033[1;31m✗\033[0m $1"; }

# 暖机
echo "暖机..."
curl -s --max-time 30 -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"warmup@taomyst.top\",\"turnstileToken\":\"any\"}" >/dev/null

# 1. 准备：每用户独立注册 + 登录 + 简历
echo -e "\n\033[1;36m━━━ 准备 $N 个用户 ━━━\033[0m"

# 1.1 并发发码
for i in $(seq 1 $N); do
  EMAIL="con${i}-$(date +%s)-$RANDOM@taomyst.top"
  echo "$EMAIL" > "$COOKIES_DIR/u${i}.email"
  curl -s -X POST "$BASE/api/auth/send-verify-code" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"turnstileToken\":\"any\"}" >/dev/null &
done
wait
sleep 3

# 1.2 串行：每用户注册+登录+简历（避免内部 race）
for i in $(seq 1 $N); do
  EMAIL=$(cat "$COOKIES_DIR/u${i}.email")
  CODE=$(curl -s "$BASE/api/test-helper/get-verify-code?email=$EMAIL" | grep -oE '"code":"[0-9]{6}"' | sed 's/"code":"//;s/"$//')
  if [ -z "$CODE" ]; then
    echo "  u$i 无码" > "$RESULTS_DIR/u${i}.err"
    continue
  fi
  curl -s -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!\",\"verifyCode\":\"$CODE\",\"turnstileToken\":\"any\"}" >/dev/null
  curl -s -c "$COOKIES_DIR/u${i}.cookie" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!\",\"turnstileToken\":\"any\"}" >/dev/null
  # 上传独立简历（每用户不同内容）
  {
    echo "用户${i} 简历"
    echo "经验: $((i + 2)) 年"
    echo "技术栈: $(date +%s%N)"
    echo "公司: 第 ${i} 家"
  } > "$COOKIES_DIR/u${i}.txt"
  RES=$(curl -s -b "$COOKIES_DIR/u${i}.cookie" -X POST "$BASE/api/resume/upload" \
    -F "file=@${COOKIES_DIR}/u${i}.txt;type=text/plain" --max-time 60)
  RID=$(echo "$RES" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
  if [ -z "$RID" ]; then
    echo "u${i} 简历失败: $RES" > "$RESULTS_DIR/u${i}.err"
    continue
  fi
  echo "$RID" > "$COOKIES_DIR/u${i}.resume"
done
ok "$N 个用户准备完成"

# 2. 10 路并发：创建面试 + AI 对话
echo -e "\n\033[1;36m━━━ 并发：$N 路创建 + AI 对话 ━━━\033[0m"
COMPANIES=("byte" "ali" "tencent" "bili")
START=$(date +%s)

for i in $(seq 1 $N); do
  (
    if [ -f "$RESULTS_DIR/u${i}.err" ]; then
      echo "SKIP" > "$RESULTS_DIR/u${i}.txt"
      exit 0
    fi
    COMPANY="${COMPANIES[$((i % 4))]}"
    RID=$(cat "$COOKIES_DIR/u${i}.resume")
    CR=$(curl -s -b "$COOKIES_DIR/u${i}.cookie" -X POST "$BASE/api/interview" \
      -H "Content-Type: application/json" \
      -d "{\"company\":\"$COMPANY\",\"role\":\"backend\",\"level\":\"P6\",\"resumeId\":\"$RID\"}")
    IV=$(echo "$CR" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
    if [ -z "$IV" ]; then
      echo "CREATE_FAIL:$CR" > "$RESULTS_DIR/u${i}.txt"
      exit 1
    fi
    R=$(curl -s -b "$COOKIES_DIR/u${i}.cookie" -X POST "$BASE/api/interview/$IV/message" \
      -H "Content-Type: application/json" \
      -d "{\"messages\":[{\"role\":\"user\",\"content\":\"你好，用户${i}，请介绍下面试流程\"}]}" \
      --max-time 120 -w "\nHTTP_CODE:%{http_code}\nTIME:%{time_total}\n")
    echo "$R" > "$RESULTS_DIR/u${i}.txt"
    HTTP=$(echo "$R" | grep "HTTP_CODE" | sed 's/HTTP_CODE://')
    TIME=$(echo "$R" | grep "TIME:" | sed 's/TIME://')
    echo "  u$i ($COMPANY) HTTP=$HTTP TIME=${TIME}s"
  ) &
done
wait
END=$(date +%s)
echo ""
echo "⏱  并发总耗时: $((END-START))s"

# 3. 汇总
echo -e "\n\033[1;36m━━━ 汇总 ━━━\033[0m"
HTTP_OK=0; HTTP_429=0; HTTP_500=0; HTTP_OTHER=0; CREATE_FAIL=0; SKIP=0
for i in $(seq 1 $N); do
  TXT="$RESULTS_DIR/u${i}.txt"
  [ ! -f "$TXT" ] && SKIP=$((SKIP+1)) && continue
  if grep -q "SKIP" "$TXT"; then SKIP=$((SKIP+1)); continue; fi
  if grep -q "CREATE_FAIL" "$TXT"; then CREATE_FAIL=$((CREATE_FAIL+1)); continue; fi
  HTTP=$(grep "HTTP_CODE" "$TXT" | sed 's/HTTP_CODE://')
  case "$HTTP" in
    200) HTTP_OK=$((HTTP_OK+1)) ;;
    429) HTTP_429=$((HTTP_429+1)) ;;
    500) HTTP_500=$((HTTP_500+1)) ;;
    *) HTTP_OTHER=$((HTTP_OTHER+1)) ;;
  esac
done
echo "  200 OK:   $HTTP_OK"
echo "  429 限流: $HTTP_429"
echo "  500 错误: $HTTP_500"
echo "  其他:     $HTTP_OTHER"
echo "  跳过:     $SKIP（用户准备失败）"
echo "  创建失败: $CREATE_FAIL"
echo ""
if [ $HTTP_500 -gt 0 ]; then
  echo -e "\n  \033[1;31m❌ 出现 500 错误\033[0m"
  exit 1
elif [ $((HTTP_OK + HTTP_429)) -ge $((N * 7 / 10)) ]; then
  echo -e "\n  \033[1;32m✅ 并发压测通过（≥70% 有效响应）\033[0m"
  rm -rf "$COOKIES_DIR" "$RESULTS_DIR"
  exit 0
else
  echo -e "\n  \033[1;31m❌ 不通过\033[0m"
  exit 1
fi