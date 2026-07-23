#!/bin/bash
# Phase B: 10 个真实用户 全功能压测 (寻找 user-blocking bugs)
#
# 串行跑 10 个用户画像（避免 mock AI quota 互相干扰）：
#   U1 后端 P6 byte | U2 前端 P5 ali | U3 算法 P7 byte | U4 PM P5 bili
#   U5 高并发 T3 tencent | U6 应届 P4 ali | U7 架构 P8 byte | U8 QA P6 bili
#   U9 移动 T3 tencent | U10 35+ P6 ali
#
# 每个用户跑完整套：注册 → 简历 → 创建面试 → 6 轮对话 → finish 评分 → 报告 → 付费 → 反馈 → 登出
#
# 用法:
#   bash tests/stress/phase-b-10users.sh            # 跑全部 10 用户
#   bash tests/stress/phase-b-10users.sh 1 3          # 只跑 U1-U3
#   DRY_RUN=1 bash tests/stress/phase-b-10users.sh   # 只 dry check 流程
#
# Round 9 验证基线: sse-boundary-tests 17/17 PASS + 完整 prod 部署
# Phase B 目标: 模拟真实用户走完整功能，找出 user-blocking bug 然后 loop 修复
#
# 设计:
#   - 每个用户有独立 ERROR_FILE + 独立 RES_DIR + COOKIES
#   - 用 USE_MOCK_AI=1 (dev 默认) 隔离真实 AI quota
#   - 用 DISABLE_RATE_LIMIT=1 (dev 默认) 跳过限流
#   - 任何 HTTP 5xx / 业务失败 → 该用户 fail + record 到汇总
#   - 汇总后输出 PASS / FAIL / BY_USER 表
set +e
cd "$(dirname "$0")/../.."

BASE="${BASE:-http://localhost:3001}"
DRY_RUN="${DRY_RUN:-0}"
START_UID="${1:-1}"
END_UID="${2:-10}"
RES_BASE="/tmp/phase-b-$$"
mkdir -p "$RES_BASE"

# 10 个真实用户画像（参 PRD §3 目标人群 + 现有 SSE 测试已覆盖场景）
# 字段: idx|company|level|role|user_desc(影响简历内容)
USERS=(
  "1|byte|P6|backend|我有 8 年后端经验,擅长 Go/Python,做过亿级 QPS 订单系统"
  "2|ali|P5|frontend|我有 3 年 React 经验,做过中后台系统,熟悉组件化设计"
  "3|byte|P7|algorithm|我有 8 年算法经验,深度学习推荐系统,顶会发表 3 篇"
  "4|bili|P5|product|我转型 PM 1 年,有 5 年技术背景,擅长 B 端产品"
  "5|tencent|T3|backend|高并发架构专家,11 年经验,做过微信支付核心链路"
  "6|ali|P4|java|应届生,Java Spring Boot 熟练,LeetCode 600+,ACM 区域赛银奖"
  "7|byte|P8|system_arch|资深架构师,15 年经验,主导亿级 DAU 短视频架构"
  "8|bili|P6|qa|测试工程师,8 年经验,擅长性能/自动化/质量体系建设"
  "9|tencent|T3|client|移动端 iOS/Android 开发,7 年经验,做过亿级 DAU 客户端"
  "10|ali|P6|operation|35+ 跨界转型,运营岗,10 年社群 + 内容运营经验"
)

TOTAL_FAIL=0
TOTAL_USERS=0
FAILED_USERS=""

ok() { echo -e "  \033[1;32m✓\033[0m $1"; }
fail() { TOTAL_FAIL=$((TOTAL_FAIL+1)); echo -e "  \033[1;31m✗\033[0m $1"; FAILED_USERS="$FAILED_USERS [$2]"; }

# ============== 单用户 E2E ==============
# Usage: run_user <idx> <company> <level> <role> <desc>
run_user() {
  local IDX=$1
  local COMPANY=$2
  local LEVEL=$3
  local ROLE=$4
  local DESC=$5
  local USER_NO="U${IDX}"
  local RES_DIR="$RES_BASE/$USER_NO"
  mkdir -p "$RES_DIR"

  local EMAIL="b${IDX}-$(date +%s%N | tail -c 10)-$$@taomyst.top"
  local PASS="Test1234!"
  local COOKIES="$RES_DIR/cookies.txt"
  local ERR_FILE="$RES_DIR/errors.txt"
  echo "0" > "$ERR_FILE"

  echo ""
  echo "━━━ [$USER_NO] $EMAIL | $COMPANY/$LEVEL/$ROLE ━━━"
  [ "$DRY_RUN" = "1" ] && { echo "  DRY_RUN: skip curl"; return 0; }

  local USER_FAIL=0
  fail_local() { USER_FAIL=$((USER_FAIL+1)); echo -e "  \033[1;31m✗\033[0m $1"; }
  ok_local() { echo -e "  \033[1;32m✓\033[0m $1"; }

  # === 1. 注册流程 ===
  curl -s -m 30 -X POST "$BASE/api/auth/send-verify-code" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"turnstileToken\":\"any\"}" > "$RES_DIR/send-code.json" 2>/dev/null
  sleep 2

  # Round 10 B-10-2 修: 拿验证码失败时打印原始 response (dev test-helper 偶发返回空)
  local CODE_RESP
  CODE_RESP=$(curl -s -m 10 "$BASE/api/test-helper/get-verify-code?email=$EMAIL" 2>&1)
  echo "$CODE_RESP" > "$RES_DIR/get-code.json"
  local CODE
  CODE=$(echo "$CODE_RESP" | grep -oE '"code":"[0-9]{6}"' | sed 's/"code":"//;s/"$//' || echo "")
  [ -n "$CODE" ] && ok_local "1.1 验证码: $CODE" || fail_local "1.1 拿不到验证码: $(echo "$CODE_RESP" | head -c 200)"

  local R
  R=$(curl -s -m 30 -c "$COOKIES" -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"verifyCode\":\"$CODE\",\"turnstileToken\":\"any\"}")
  if echo "$R" | grep -q '"ok":true'; then
    ok_local "1.2 注册成功"
  else
    fail_local "1.2 注册失败: $(echo "$R" | head -c 150)"
    return 1
  fi

  local ME
  ME=$(curl -s -m 10 -b "$COOKIES" "$BASE/api/auth/me")
  echo "$ME" | grep -q "\"email\":\"$EMAIL\"" && ok_local "1.3 /me 正确" || fail_local "1.3 /me 错误: $ME"

  # === 2. 上传简历 ===
  echo "$DESC" > "$RES_DIR/resume.txt"
  # 加点项目/技能细节让解析有内容
  cat >> "$RES_DIR/resume.txt" <<EOF

技术栈: $(echo "$ROLE" | sed 's/.*/Redis,Kafka,MySQL,Docker,K8s/')
项目经验: 高并发系统 (QPS 50w), 分布式调度平台, 推荐系统, 监控告警体系
EOF

  R=$(curl -s -m 60 -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
    -F "file=@${RES_DIR}/resume.txt;type=text/plain")
  local RESUME_ID
  RESUME_ID=$(echo "$R" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
  [ -n "$RESUME_ID" ] && ok_local "2.1 简历 ID: $RESUME_ID" || fail_local "2.1 简历上传失败: $(echo "$R" | head -c 150)"

  # === 3. 创建面试 ===
  R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/interview" \
    -H "Content-Type: application/json" \
    -d "{\"company\":\"$COMPANY\",\"role\":\"$ROLE\",\"level\":\"$LEVEL\",\"resumeId\":\"$RESUME_ID\"}")
  echo "$R" > "$RES_DIR/create-interview.json"
  local INTERVIEW_ID
  INTERVIEW_ID=$(echo "$R" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
  [ -n "$INTERVIEW_ID" ] && ok_local "3.1 面试 ID: $INTERVIEW_ID" || fail_local "3.1 面试创建失败: $(echo "$R" | head -c 150)"

  # === 4. 6 轮对话 (SSE) ===
  # 1-5 正常, 第 6 轮 finish=true 触发评分
  local CONV_OK=0
  for r in 1 2 3 4 5; do
    local HTTP
    HTTP=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/interview/$INTERVIEW_ID/message" \
      -H "Content-Type: application/json" \
      -d "{\"messages\":[{\"role\":\"user\",\"content\":\"第 $r 轮回答: 我会先用 Redis 缓存热点数据, 再用 Kafka 异步削峰\"}],\"finish\":false}" \
      -w "\n__HTTP__:%{http_code}\n" \
      -o "$RES_DIR/round$r.txt" 2>/dev/null)
    HTTP=$(echo "$HTTP" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
    if [ "$HTTP" = "200" ]; then
      CONV_OK=$((CONV_OK+1))
    else
      fail_local "4.$r round HTTP=$HTTP"
    fi
    sleep 1
  done
  [ "$CONV_OK" -eq 5 ] && ok_local "4.x 5 轮对话 200" || fail_local "4.x 只 $CONV_OK/5 成功"

  # === 5. 触发评分（finish=true）===
  # SSE 流 + finish 触发 fire-and-forget 评分
  curl -s -m 60 -b "$COOKIES" -X POST "$BASE/api/interview/$INTERVIEW_ID/message" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"最后一个问题: 整体介绍下你的架构思路\"}],\"finish\":true}" \
    -o "$RES_DIR/finish.txt" 2>/dev/null

  if grep -q '"bizStatus":"success"' "$RES_DIR/finish.txt" || grep -q '"content"' "$RES_DIR/finish.txt"; then
    ok_local "5.1 finish 流业务成功"
  else
    fail_local "5.1 finish 流无业务成功: $(head -c 200 "$RES_DIR/finish.txt")"
  fi

  # Round 9: finish fire-and-forget, 等 ~8s 让 mock 5 维度评分 + 写入完成
  sleep 10

  # === 6. 评分报告 ===
  R=$(curl -s -m 30 -b "$COOKIES" "$BASE/api/interview/$INTERVIEW_ID/report")
  echo "$R" > "$RES_DIR/report.json"
  local SCORE
  SCORE=$(echo "$R" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read(), strict=False).get('data',{}).get('report') or json.loads(sys.stdin.read(), strict=False).get('report')
    if d:
        v = d.get('totalScore') if isinstance(d, dict) else None
        print(v if v is not None else 'NONE')
    else:
        print('NONE')
except Exception as e:
    print(f'ERROR:{e}')
" 2>/dev/null)
  if [ -n "$SCORE" ] && [ "$SCORE" != "NONE" ] && [ "$SCORE" != "60" ]; then
    ok_local "6.1 报告 totalScore=$SCORE"
  elif [ "$SCORE" = "60" ]; then
    fail_local "6.1 评分兜底 60, 真实 AI 污染或 mock 没生效"
  else
    fail_local "6.1 报告未生成: score=$SCORE $(echo "$R" | head -c 150)"
  fi

  # === 7. 付费 (mock) ===
  R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/payment" \
    -H "Content-Type: application/json" -d '{"quantity":1}')
  echo "$R" > "$RES_DIR/pay-create.json"
  local PAY_ID
  PAY_ID=$(echo "$R" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"$//')
  [ -n "$PAY_ID" ] && ok_local "7.1 支付订单: $PAY_ID" || fail_local "7.1 订单创建失败 (empty body?): $(echo "$R" | head -c 200)"

  # Round 10 B-10-3 修: 加 -w 看 HTTP_CODE + TIME,空响应能定位是 server 慢还是脚本 bug
  HTTP=000
  R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/payment/$PAY_ID/confirm" \
    -w "\n__HTTP__:%{http_code} __TIME__:%{time_total}\n" \
    -o "$RES_DIR/pay-confirm-body.txt" 2>"$RES_DIR/pay-confirm-err.txt")
  HTTP=$(echo "$R" | grep -oE '__HTTP__:[0-9]+' | sed 's/__HTTP__://')
  TIME=$(echo "$R" | grep -oE '__TIME__:[0-9.]+' | sed 's/__TIME__://')
  BODY=$(cat "$RES_DIR/pay-confirm-body.txt" 2>/dev/null || echo "(no body file)")
  if [ "$HTTP" = "200" ] && echo "$BODY" | grep -q '"granted":1'; then
    ok_local "7.2 付费成功 granted=1 (${TIME}s)"
  else
    fail_local "7.2 付费 HTTP=$HTTP TIME=${TIME}s body=${BODY:0:150}"
  fi

  # === 8. 反馈 ===
  R=$(curl -s -m 30 -b "$COOKIES" -X POST "$BASE/api/feedback" \
    -H "Content-Type: application/json" \
    -d "{\"category\":\"FEATURE\",\"content\":\"用户 $EMAIL 测试反馈: 整体流程顺滑,期望增加更多公司场景\",\"contactEmail\":\"$EMAIL\",\"website\":\"\",\"company_name\":\"\",\"phone_number\":\"\"}")
  echo "$R" > "$RES_DIR/feedback.json"
  if echo "$R" | grep -q '"ok":true'; then
    ok_local "8.1 反馈提交"
  else
    fail_local "8.1 反馈失败: $(echo "$R" | head -c 150)"
  fi

  # === 9. 登出 ===
  R=$(curl -s -m 10 -b "$COOKIES" -X POST "$BASE/api/auth/logout")
  if echo "$R" | grep -q '"ok":true'; then
    ok_local "9.1 登出成功"
  else
    fail_local "9.1 登出失败: $R"
  fi

  if [ "$USER_FAIL" -gt 0 ]; then
    fail "$USER_NO 失败 $USER_FAIL 项" "$USER_NO"
  else
    echo -e "  \033[1;32m✅ $USER_NO 全部通过\033[0m"
  fi
  TOTAL_USERS=$((TOTAL_USERS+1))
}

# ============== 主循环 ==============
echo "━━━ Phase B: 10 用户全功能压测 (dev server $BASE) ━━━"
echo "  Mock AI + disable rate-limit + test-helper ON"
echo "  产物目录: $RES_BASE"
echo ""

for LINE in "${USERS[@]}"; do
  IDX=$(echo "$LINE" | cut -d'|' -f1)
  COMPANY=$(echo "$LINE" | cut -d'|' -f2)
  LEVEL=$(echo "$LINE" | cut -d'|' -f3)
  ROLE=$(echo "$LINE" | cut -d'|' -f4)
  DESC=$(echo "$LINE" | cut -d'|' -f5)
  if [ "$IDX" -ge "$START_UID" ] && [ "$IDX" -le "$END_UID" ]; then
    run_user "$IDX" "$COMPANY" "$LEVEL" "$ROLE" "$DESC"
  fi
done

# ============== 汇总 ==============
echo ""
echo "================================="
echo -e "\033[1;36mPhase B 汇总:\033[0m"
echo "  跑过用户: $TOTAL_USERS / 10"
echo "  失败用户: $FAILED_USERS (共 $TOTAL_FAIL 个测试项失败)"
echo "  产物: $RES_BASE"

if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo ""
  echo -e "\033[1;32m✅ 10 用户全功能 0 阻塞\033[0m"
  exit 0
else
  echo ""
  echo -e "\033[1;31m❌ 发现 user-blocking bugs, 进 Round 10+ 修复\033[0m"
  echo ""
  echo "排查指引:"
  echo "  cat $RES_BASE/U<idx>/*.json (看 5xx response)"
  echo "  ls $RES_BASE/ (按用户分目录)"
  exit 1
fi
