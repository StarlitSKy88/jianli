#!/bin/bash
# Round 6: SSE 流式响应边界压测
#
# 12 个原子级边界场景:
#   E1 鉴权失败(无 cookie)         → 401
#   E2 面试不存在                  → 404
#   E3 无权访问他人面试             → 403
#   E4 空 messages                 → 400 VALIDATION_ERROR
#   E5 单条 content > 2000 字符     → 400 VALIDATION_ERROR
#   E6 面试已 COMPLETED             → 400 INTERVIEW_ENDED
#   E7 content 含 \n / 双引号        → SSE 流正常,业务成功
#   E8 finish=true + messages 正常  → 评分触发,业务成功,X-Biz-Status=success
#   E9 finish=true + 0 messages     → 400 或业务处理
#   E10 同一面试并发 finish 两次     → race condition(可能双评分/单评分)
#   E11 SSE 客户端中途 abort         → server 端 cleanup,无 5xx
#   E12 content 含 JSON 注入 "}}      → SSE 解析不崩
#
# 设计原则:
#   - 全部用 mock AI (USE_MOCK_AI=1) 隔离真实 quota
#   - 每个 case 独立 register 一个新用户(避免互污染)
#   - 区分 HTTP 状态 vs 业务状态 (X-Biz-Status header)
#   - SSE 解析:curl -N + grep "data:" 行
set +e
cd "$(dirname "$0")/../.."

BASE="${BASE:-http://localhost:3001}"
RES_DIR="./.stress-${BASHPID:-$$}"
mkdir -p "$RES_DIR"

ok() { echo -e "  \033[1;32m✓\033[0m $1"; }
fail() { echo -e "  \033[1;31m✗\033[0m $1"; }

# 注册 + 创建面试 helper
# 输出: $COOKIES $EMAIL $IV $RESUME_ID
register_and_setup() {
  local COOKIES=$1
  local TS=$(date +%s%N | tail -c 9)
  local EMAIL="r6-${TS}-$$@taomyst.top"

  curl -s -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\"}" \
    "$BASE/api/auth/send-verify-code" > /dev/null
  sleep 1
  local CODE=$(curl -s "$BASE/api/test-helper/get-verify-code?email=$EMAIL" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['code'])" 2>/dev/null)
  [ -z "$CODE" ] && { echo "FATAL: no verify code for $EMAIL" >&2; return 1; }

  rm -f "$COOKIES"
  curl -s -c "$COOKIES" -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"Pass1234!\",\"verifyCode\":\"$CODE\",\"nickname\":\"R6\"}" \
    "$BASE/api/auth/register" > /dev/null

  echo "我有 10 年后端经验" > /tmp/r6r.txt
  local RESUME_ID=$(curl -s -b "$COOKIES" -F "file=@/tmp/r6r.txt" \
    "$BASE/api/resume/upload" | python3 -c "import sys,json; print(json.load(sys.stdin)['resume']['id'])")
  local IV=$(curl -s -b "$COOKIES" -X POST -H "Content-Type: application/json" \
    -d "{\"resumeId\":\"$RESUME_ID\",\"company\":\"byte\",\"role\":\"backend\",\"level\":\"P7\"}" \
    "$BASE/api/interview" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

  echo "$EMAIL|$IV|$RESUME_ID"
}

# SSE 调用 + 解析
# 用法: sse_call "$COOKIES" "$IV" "$JSON_PAYLOAD" "$OUT_FILE"
sse_call() {
  local COOKIES=$1; local IV=$2; local PAYLOAD=$3; local OUT=$4
  curl -s -N -b "$COOKIES" -X POST -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "$BASE/api/interview/$IV/message" \
    -D "$OUT.headers" -o "$OUT"
}

# 提取 SSE data 行内容
extract_data() {
  grep -oE '^data: .*$' "$1" | sed 's/^data: //' || true
}

# 从 data 行里看是否含错误码
has_error_code() {
  local FILE=$1; local CODE=$2
  extract_data "$FILE" | grep -q "\"$CODE\""
}

extract_biz_status() {
  grep -i '^x-biz-status:' "$1" | head -1 | tr -d '\r' | awk '{print $2}'
}

PASS=0; FAIL=0

echo "━━━ E1: 鉴权失败(无 cookie) ━━━"
COOKIES="$RES_DIR/c1.txt"; rm -f $COOKIES
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/api/interview/fake-id/message")
[ "$HTTP" = "401" ] && ok "E1 401 ✓" || fail "E1 期望 401 实际 $HTTP"
[ "$HTTP" = "401" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

# 注册用户 A (用所有 case)
echo ""
echo "━━━ 准备用户 A (E2-E12) ━━━"
COOKIES_A="$RES_DIR/ca.txt"; rm -f $COOKIES_A
INFO_A=$(register_and_setup "$COOKIES_A")
EMAIL_A=$(echo $INFO_A | cut -d'|' -f1)
IV_A=$(echo $INFO_A | cut -d'|' -f2)
echo "  user A: $EMAIL_A interview=$IV_A"

# 注册用户 B (E3 用)
COOKIES_B="$RES_DIR/cb.txt"; rm -f $COOKIES_B
INFO_B=$(register_and_setup "$COOKIES_B")
IV_B=$(echo $INFO_B | cut -d'|' -f2)
echo "  user B interview=$IV_B (用 E3 测无权访问)"

echo ""
echo "━━━ E2: 面试不存在 ━━━"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES_A" -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/api/interview/cmnonsuchid000000000000000/message")
[ "$HTTP" = "404" ] && ok "E2 404 ✓" || fail "E2 期望 404 实际 $HTTP"
[ "$HTTP" = "404" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━ E3: 无权访问他人面试 ━━━"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES_A" -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/api/interview/$IV_B/message")
[ "$HTTP" = "403" ] && ok "E3 403 ✓" || fail "E3 期望 403 实际 $HTTP"
[ "$HTTP" = "403" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━ E4: 空 messages ━━━"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES_A" -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[]}' \
  "$BASE/api/interview/$IV_A/message")
[ "$HTTP" = "400" ] && ok "E4 400 ✓" || fail "E4 期望 400 实际 $HTTP"
[ "$HTTP" = "400" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━ E5: 单条 content > 2000 字符 ━━━"
LONG=$(python3 -c "print('x' * 2001)")
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES_A" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$LONG\"}]}" \
  "$BASE/api/interview/$IV_A/message")
[ "$HTTP" = "400" ] && ok "E5 400 ✓" || fail "E5 期望 400 实际 $HTTP"
[ "$HTTP" = "400" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━ E6: 面试已 COMPLETED ━━━"
# 先用正常 finish 让 A 的面试结束
curl -s -b "$COOKIES_A" -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"结束"}],"finish":true}' \
  "$BASE/api/interview/$IV_A/message" > /dev/null
sleep 1
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES_A" -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"再来一轮"}]}' \
  "$BASE/api/interview/$IV_A/message")
[ "$HTTP" = "400" ] && ok "E6 400 ✓" || fail "E6 期望 400 实际 $HTTP"
[ "$HTTP" = "400" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━ E7: content 含 \\n / 双引号 (用户 B 的面试还活着) ━━━"
OUT="$RES_DIR/e7.txt"; HEADERS="$RES_DIR/e7.h"
sse_call "$COOKIES_B" "$IV_B" \
  "{\"messages\":[{\"role\":\"user\",\"content\":\"他说：\\\"hello\\\"\\n然后走了\"}],\"finish\":false}" \
  "$OUT" 2>/dev/null
DATA=$(extract_data "$OUT")
if echo "$DATA" | grep -q '"content"'; then
  ok "E7 SSE 流正常,业务成功"
  PASS=$((PASS+1))
else
  fail "E7 SSE 流异常: ${DATA:0:200}"
  FAIL=$((FAIL+1))
fi

echo ""
echo "━━━ E8: finish=true 评分触发 ━━━"
OUT="$RES_DIR/e8.txt"; HEADERS="$RES_DIR/e8.h"
sse_call "$COOKIES_B" "$IV_B" \
  '{"messages":[{"role":"user","content":"好的,结束"}],"finish":true}' \
  "$OUT" 2>/dev/null
# Round 9: finish 评分改成 fire-and-forget,需要等 mock 5 维度 + Prisma 写入 ~5s
sleep 8
REPORT=$(curl -s -b "$COOKIES_B" "$BASE/api/interview/$IV_B/report")
SCORE=$(echo "$REPORT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('report',{}).get('totalScore') or 'NONE')")
if [ "$SCORE" != "NONE" ] && [ "$SCORE" != "60" ]; then
  ok "E8 评分差异化入库 totalScore=$SCORE"
  PASS=$((PASS+1))
elif [ "$SCORE" = "60" ]; then
  fail "E8 评分是兜底 60,说明真实 AI 污染或 mock 没生效"
  FAIL=$((FAIL+1))
else
  fail "E8 报告未生成: $REPORT"
  FAIL=$((FAIL+1))
fi

echo ""
echo "━━━ E9: finish=true + 空 messages ━━━"
# 注册新用户 C (因为 B 已结束)
COOKIES_C="$RES_DIR/cc.txt"; rm -f $COOKIES_C
INFO_C=$(register_and_setup "$COOKIES_C")
IV_C=$(echo $INFO_C | cut -d'|' -f2)
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES_C" -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[],"finish":true}' \
  "$BASE/api/interview/$IV_C/message")
[ "$HTTP" = "400" ] && ok "E9 400 (empty 优先) ✓" || fail "E9 期望 400 实际 $HTTP"
[ "$HTTP" = "400" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━ E10: 同一面试并发 finish 两次 ━━━"
# 注册 D,启动 2 个并发 finish 请求
COOKIES_D="$RES_DIR/cd.txt"; rm -f $COOKIES_D
INFO_D=$(register_and_setup "$COOKIES_D")
IV_D=$(echo $INFO_D | cut -d'|' -f2)
curl -s -b "$COOKIES_D" -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"先说点"}]}' \
  "$BASE/api/interview/$IV_D/message" > /dev/null
# 并发 2 个 finish
( curl -s -N -b "$COOKIES_D" -X POST -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"并发A结束"}],"finish":true}' \
    "$BASE/api/interview/$IV_D/message" > "$RES_DIR/e10a.txt" 2>&1 ) &
( curl -s -N -b "$COOKIES_D" -X POST -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"并发B结束"}],"finish":true}' \
    "$BASE/api/interview/$IV_D/message" > "$RES_DIR/e10b.txt" 2>&1 ) &
wait
# Round 9: finish 评分改成 fire-and-forget,需要等 mock 5 维度 + Prisma 写入 ~5s
sleep 8
# 关键断言:报告仍然存在且 totalScore 不为 None
REPORT=$(curl -s -b "$COOKIES_D" "$BASE/api/interview/$IV_D/report")
SCORE=$(echo "$REPORT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('report',{}).get('totalScore') or 'NONE')")
if [ "$SCORE" != "NONE" ] && [ "$SCORE" != "60" ]; then
  ok "E10 race 后 totalScore=$SCORE (无 race condition 崩溃)"
  PASS=$((PASS+1))
else
  fail "E10 race 后报告异常: score=$SCORE report=$REPORT"
  FAIL=$((FAIL+1))
fi

echo ""
echo "━━━ E11: SSE 客户端 abort ━━━"
# 注册 E
COOKIES_E="$RES_DIR/ce.txt"; rm -f $COOKIES_E
INFO_E=$(register_and_setup "$COOKIES_E")
IV_E=$(echo $INFO_E | cut -d'|' -f2)
# 用 --max-time 1 让 curl 1 秒后断开 (mock 流大概 ~100ms)
curl -s -N --max-time 1 -b "$COOKIES_E" -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"测试"}]}' \
  "$BASE/api/interview/$IV_E/message" > /dev/null 2>&1
# 再发一个正常请求,验证 server 没崩
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES_E" -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"再来一次"}]}' \
  "$BASE/api/interview/$IV_E/message")
[ "$HTTP" = "200" ] && ok "E11 abort 后 server 仍 200 ✓" || fail "E11 abort 后期望 200 实际 $HTTP"
[ "$HTTP" = "200" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo ""
echo "━━━ E12: content 含 JSON 注入 \"}} ━━━"
# 用户 E 的面试还活着 (E11 没 finish)
OUT="$RES_DIR/e12.txt"
curl -s -N -b "$COOKIES_E" -X POST -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"测试 \\\"\\\"\\\" 注入 + \\n 换行\"}]}" \
  "$BASE/api/interview/$IV_E/message" -o "$OUT" 2>/dev/null
DATA=$(extract_data "$OUT")
if echo "$DATA" | grep -q '"content"'; then
  ok "E12 JSON 注入不崩,SSE 解析成功"
  PASS=$((PASS+1))
else
  fail "E12 SSE 解析失败: ${DATA:0:200}"
  FAIL=$((FAIL+1))
fi

# Round 7: 业务状态事件验证 (X-Biz-Status 已废弃,改在 SSE event 里发 bizStatus)
#   E13 SSE 数据流应含 bizStatus="success" 事件
#   E14 finish=true 时 bizStatus 仍为 success (业务成功 = 评分成功入库)
#   E15 不应再返回 x-biz-status header (HTTP 协议层无法更新)
#   E16 异常场景: 在这条留待观察 (D2 后续可能补)

echo ""
echo "━━━ E13: 非 finish 流 应含 bizStatus=success 事件 ━━━"
COOKIES_F="$RES_DIR/cf.txt"; rm -f $COOKIES_F
INFO_F=$(register_and_setup "$COOKIES_F")
IV_F=$(echo $INFO_F | cut -d'|' -f2)
curl -s -N -b "$COOKIES_F" -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"业务状态测试"}]}' \
  -D "$RES_DIR/e13.h" -o "$RES_DIR/e13.txt" \
  "$BASE/api/interview/$IV_F/message" 2>/dev/null
E13_DATA=$(extract_data "$RES_DIR/e13.txt")
if echo "$E13_DATA" | grep -q '"bizStatus":"success"'; then
  ok "E13 bizStatus=success 事件 ✓"
  PASS=$((PASS+1))
else
  fail "E13 没找到 bizStatus=success 事件: ${E13_DATA:0:200}"
  FAIL=$((FAIL+1))
fi

echo ""
echo "━━━ E14: finish=true 流 应含 bizStatus=success (评分成功) ━━━"
OUT_F="$RES_DIR/e14.txt"
sse_call "$COOKIES_F" "$IV_F" \
  '{"messages":[{"role":"user","content":"E14 收尾"}],"finish":true}' \
  "$OUT_F" 2>/dev/null
sleep 3
E14_DATA=$(extract_data "$OUT_F")
if echo "$E14_DATA" | grep -q '"bizStatus":"success"'; then
  ok "E14 finish 流 bizStatus=success 事件 ✓"
  PASS=$((PASS+1))
else
  fail "E14 finish 流没找到 bizStatus=success: ${E14_DATA:0:200}"
  FAIL=$((FAIL+1))
fi

echo ""
echo "━━━ E15: 不应再返回 x-biz-status HTTP header ━━━"
# HTTP header 一旦发出就不可变,业务状态只能在 SSE event 里传
# 这是 Round 7 的核心修复:从 header 改到 SSE event
COOKIES_G="$RES_DIR/cg.txt"; rm -f $COOKIES_G
INFO_G=$(register_and_setup "$COOKIES_G")
IV_G=$(echo $INFO_G | cut -d'|' -f2)
curl -s -N -b "$COOKIES_G" -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"header 测试"}]}' \
  -D "$RES_DIR/e15.h" -o /dev/null \
  "$BASE/api/interview/$IV_G/message" 2>/dev/null
# 过滤大小写,因为 RFC 7230 头字段大小写不敏感
HAS_HEADER=$(grep -i '^x-biz-status:' "$RES_DIR/e15.h" | head -1 | tr -d '\r' | awk '{print $2}')
if [ -z "$HAS_HEADER" ]; then
  ok "E15 x-biz-status header 已移除 ✓"
  PASS=$((PASS+1))
elif [ "$HAS_HEADER" = "pending" ]; then
  fail "E15 仍然返回永远 pending 的 header (Round 7 修复目标)"
  FAIL=$((FAIL+1))
else
  fail "E15 x-biz-status header 仍是 '$HAS_HEADER',需移除"
  FAIL=$((FAIL+1))
fi

echo ""
echo "━━━ E16: client 早断 不应触发 assistant message ghost 写入 ━━━"
# Round 8A 修复目标: 当前代码不感知 cancel,prisma.message.create 在 client 走后仍写库
# 断言: 用 --max-time 0.05 早断,等 3s,验证该 interview 的 messageCount 只 +1 (user)
COOKIES_H="$RES_DIR/ch.txt"; rm -f $COOKIES_H
INFO_H=$(register_and_setup "$COOKIES_H")
IV_H=$(echo $INFO_H | cut -d'|' -f2)
BEFORE=$(curl -s -b "$COOKIES_H" "$BASE/api/interview/$IV_H" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',{}).get('interview',{}).get('messages',[])))")
# 早断请求 (mock 大概 100ms 出结果,client 50ms 断开,server 端 ghost enqueue + DB 写入已不再受 cancel 影响)
curl -s -N -b "$COOKIES_H" --max-time 0.05 \
  -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"client 早断测试 E16"}]}' \
  "$BASE/api/interview/$IV_H/message" > /dev/null 2>&1
sleep 3
AFTER=$(curl -s -b "$COOKIES_H" "$BASE/api/interview/$IV_H" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',{}).get('interview',{}).get('messages',[])))")
DELTA=$((AFTER - BEFORE))
if [ "$DELTA" -le 1 ]; then
  ok "E16 client abort 后只入库 user message (+$DELTA,无 ghost write) ✓"
  PASS=$((PASS+1))
else
  fail "E16 client abort 后 messageCount 从 $BEFORE → $AFTER (+$DELTA),ghost 写入严重"
  FAIL=$((FAIL+1))
fi

echo ""
echo "━━━ E17: client 早断在 finish 时 不应丢失评分 + status (Round 9 RED→GREEN) ━━━"
# Round 9 修复目标: client 在 finish=true 时 50ms 早断 → finish 评分路径 (fire-and-forget) 仍完成
#   期望: status=COMPLETED + totalScore 存在 + report 存在 (来自 .knowledge/bugs/2026-07-24-finish-score-lost-on-client-abort.md)
# 注: GET /api/interview/[id] 不 include report,需用 /api/interview/[id]/report 查报告
COOKIES_I="$RES_DIR/ci.txt"; rm -f $COOKIES_I
INFO_I=$(register_and_setup "$COOKIES_I")
IV_I=$(echo $INFO_I | cut -d'|' -f2)
curl -s -N -b "$COOKIES_I" --max-time 0.05 \
  -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"finish+abort"}],"finish":true}' \
  "$BASE/api/interview/$IV_I/message" > /dev/null 2>&1
# 评分需要并发跑 5 维度,USE_MOCK_AI 也需 ~3s + fire-and-forget 不阻塞 client
# POST handler 等 stream 关闭(可能 8-13s)也观察 totalScore 是否就绪 — 给 15s 余量
sleep 15
E17_JSON=$(curl -s -b "$COOKIES_I" "$BASE/api/interview/$IV_I")
STATUS=$(echo "$E17_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read(), strict=False).get('data',{}).get('interview',{}).get('status','?'))")
TSCORE=$(echo "$E17_JSON" | python3 -c "import sys,json; d=json.loads(sys.stdin.read(), strict=False).get('data',{}).get('interview',{}); v=d.get('totalScore'); print('None' if v is None else v)")
REPORT_JSON=$(curl -s -b "$COOKIES_I" "$BASE/api/interview/$IV_I/report")
REPORT_OK=$(echo "$REPORT_JSON" | python3 -c "import sys,json; d=json.loads(sys.stdin.read(), strict=False); r=d.get('data',{}).get('report') or d.get('report'); print(1 if r else 0)" 2>/dev/null)
REPORT_OK=${REPORT_OK:-0}
if [ "$STATUS" = "COMPLETED" ] && [ "$TSCORE" != "None" ] && [ "$REPORT_OK" = "1" ]; then
  ok "E17 client finish+abort 后 status=$STATUS totalScore=$TSCORE report=存在 ✓"
  PASS=$((PASS+1))
else
  fail "E17 client finish+abort 后 status=$STATUS totalScore=$TSCORE report=${REPORT_OK}份 (期望 COMPLETED + totalScore>0 + report=1)"
  FAIL=$((FAIL+1))
fi

echo ""
echo "================================="
echo -e "\033[1;36mRound 8A 汇总:\033[0m PASS=$PASS FAIL=$FAIL SKIP=1 (Round 6 12 + Round 7 3 + Round 8A E16 1 = 期望 16/16;E17 PENDING→Round 9)"
echo "产物: $RES_DIR"
[ $FAIL -eq 0 ] && exit 0 || exit 1