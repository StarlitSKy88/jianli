#!/bin/bash
# Phase 14.2 v2: 单用户 30 轮完整深度面试（Python JSON 解析）
set +e
cd "$(dirname "$0")/../.."

BASE="${BASE:-http://localhost:3001}"
RES_DIR="./.stress14.2-r-$$"
mkdir -p "$RES_DIR"
ROUND=30
COOKIES="$RES_DIR/cookies.txt"
rm -f "$COOKIES"

# Python 解析辅助
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); k='$1'.split('.'); v=d
for kk in k: v=v[kk] if isinstance(v,dict) else v[int(kk)]
print(v if v is not None else '')"; }

ok() { echo -e "  \033[1;32m✓\033[0m $1"; }
fail() { echo -e "  \033[1;31m✗\033[0m $1"; }

# 30 个真实场景化提问
QUESTIONS=(
  "你好，我叫李明，今年38岁，有10年后端开发经验"
  "我之前在字节跳动做过 3 年推荐系统后端"
  "推荐系统后端的核心挑战是低延迟和高吞吐"
  "我们用 Flink 实时计算用户兴趣向量"
  "Flink 的 watermark 机制能解决乱序问题"
  "乱序问题在大流量下很常见，比如百万 QPS"
  "我当时做的一个优化是把 Redis pipeline 化"
  "Redis pipeline 减少了 70% 的网络往返时间"
  "另一个优化是引入本地缓存 LRU + 分布式缓存"
  "这样能扛住热点 key 的访问压力"
  "热点 key 的本质是流量倾斜"
  "流量倾斜在直播间和电商秒杀很常见"
  "秒杀系统的设计核心是库存扣减的原子性"
  "我们用 Redis Lua 脚本保证原子扣减"
  "Lua 脚本比分布式锁性能高 10 倍"
  "分布式锁在 Redis 主从切换时可能失效"
  "所以用 Redlock 或者 etcd 更可靠"
  "但 Redlock 实现复杂，运维成本高"
  "实际项目我们用 Redis 集群 + 异步补偿"
  "异步补偿基于消息队列，最终一致性"
  "Kafka 在我们项目里扛日均千亿级消息"
  "Kafka 的 ISR 机制保证数据不丢"
  "ISR 收缩和扩张是 Kafka 运维的关键"
  "遇到过 ISR 频繁收缩的问题吗"
  "遇到过，后来调小了 replica.lag.time.max.ms"
  "另外 producer 用 acks=all + idempotent 保证不丢"
  "幂等性是用 PID + sequence number 实现的"
  "是的，broker 端会缓存最近 5 个 sequence"
  "聊一下你的职业规划，35+ 之后怎么走"
  "我面试结束了，谢谢"
)

# 暖机（避开 IP 限流：长间隔 + 跳过实际请求）
# 注意：send-verify-code IP 限流 60s 1 次，所以脚本里只能发 1 次（不能暖机 + 测试发码两次）
echo "暖机 (sleep 65s 避开 IP 限流)..."
sleep 65
curl -s --max-time 30 -X POST "$BASE/api/auth/send-verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"d30-warmup-$(date +%s)@taomyst.top\",\"turnstileToken\":\"any\"}" >/dev/null

# 1. 准备（暖机已完成，下一发 verify-code 不需要等）
echo -e "\n\033[1;36m━━━ 准备 1 个用户 ━━━\033[0m"
EMAIL="d30-$(date +%s)-$RANDOM@taomyst.top"
echo "  email: $EMAIL"
# 暖机那一次已耗尽 60s 配额，这次 send 必然 429。
# 解法：直接 upsert user + 验证码绕过 send
cat > "$RES_DIR/seed-user.js" <<'NODE_EOF'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const email = process.argv[2];
const password = process.argv[3];
async function trySeed(attempt) {
  const p = new PrismaClient();
  try {
    const existing = await p.user.findUnique({ where: { email } });
    if (existing && existing.passwordHash) {
      console.log('EXISTS=' + existing.id);
      await p.$disconnect();
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await p.user.upsert({
      where: { email },
      update: {
        passwordHash,
        verifyCode: code,
        verifyExpiry: new Date(Date.now() + 600_000),
      },
      create: {
        email,
        passwordHash,
        verifyCode: code,
        verifyExpiry: new Date(Date.now() + 600_000),
      },
    });
    console.log('CODE=' + code);
    await p.$disconnect();
  } catch (e) {
    console.log('ERR_' + attempt + '=' + (e.message || '').split('\n')[0]);
    await p.$disconnect();
    if (attempt < 4 && /Can't reach database|ECONN|ETIMEDOUT|timeout/i.test(e.message)) {
      await new Promise(r => setTimeout(r, 2000));
      return trySeed(attempt + 1);
    }
    process.exit(1);
  }
}
trySeed(1);
NODE_EOF
DBURL="$(grep DATABASE_URL .env.local | sed 's/DATABASE_URL="//;s/"$//')"
SEED=$(DATABASE_URL="$DBURL" node "$RES_DIR/seed-user.js" "$EMAIL" "Test1234!" 2>&1)
CODE=$(echo "$SEED" | grep -oE 'CODE=[0-9]+' | tail -1 | sed 's/CODE=//')
[ -z "$CODE" ] && CODE=$(echo "$SEED" | grep -oE '"code":"[0-9]+"' | tail -1 | sed 's/"code":"//;s/"//')
[ -n "$CODE" ] && echo "  通过 DB 直接种入验证码 $CODE" || { fail "种子失败: $SEED"; exit 1; }
# 直接用 seed 输出的 CODE，不需要再次 GET-verify-code

REG=$(curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!\",\"verifyCode\":\"$CODE\",\"turnstileToken\":\"any\"}")
echo "  register: $REG" | head -c 200
LOGIN=$(curl -s -c "$COOKIES" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!\",\"turnstileToken\":\"any\"}")
echo "  login: $LOGIN" | head -c 200
ME=$(curl -s -b "$COOKIES" "$BASE/api/auth/me")
echo "  /me: $ME" | head -c 200
echo ""
[[ "$ME" == *"$EMAIL"* ]] && ok "登录 + /me OK" || { fail "/me: $ME"; exit 1; }

# 简历
RESUME_TXT="$RES_DIR/resume.txt"
cat > "$RESUME_TXT" <<EOF
李明
38岁 | 10年Go后端 | 字节跳动推荐系统
技术栈: Go / Flink / Kafka / Redis / Kubernetes
项目: 抖音推荐后端 / TikTok 直播弹幕
$(date +%s%N)
EOF
RID=$(curl -s -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@${RESUME_TXT};type=text/plain" --max-time 60 \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('data',{}).get('resume',{}).get('id') or r.get('resume',{}).get('id') or r.get('id',''))")
[ -n "$RID" ] && ok "简历 $RID" || { fail "简历失败"; exit 1; }

# 1.5 充值 paidQuota=100（关键：必须 await node 进程结束 + 冷启动重试）
echo "  → 充值 paidQuota=100..."
cat > "$RES_DIR/charge.js" <<'NODE_EOF'
const { PrismaClient } = require('@prisma/client');
const email = process.argv[2];
async function charge(attempt) {
  const p = new PrismaClient();
  try {
    const u = await p.user.update({ where: { email }, data: { paidQuota: 100, freeQuotaUsed: 0 } });
    console.log('OK=' + u.paidQuota);
    await p.$disconnect();
  } catch (e) {
    console.log('ERR_' + attempt + '=' + (e.message || '').split('\n')[0]);
    await p.$disconnect();
    if (attempt < 4 && /Can't reach database|ECONN|ETIMEDOUT|timeout/i.test(e.message)) {
      await new Promise(r => setTimeout(r, 2000));
      return charge(attempt + 1);
    }
    process.exit(1);
  }
}
charge(1);
NODE_EOF
DBURL="$(grep DATABASE_URL .env.local | sed 's/DATABASE_URL="//;s/"$//')"
QUOTA=$(DATABASE_URL="$DBURL" node "$RES_DIR/charge.js" "$EMAIL" 2>&1 | grep -E '^(OK|ERR_[0-9]+)=' | tail -1 | sed 's/^[^=]*=//')
echo "  → paidQuota=$QUOTA"
[ "$QUOTA" = "100" ] && ok "充值成功" || { fail "充值失败（paidQuota=$QUOTA）"; exit 1; }

# 2. 创建面试
echo "  → 创建面试..."
CR=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview" \
  -H "Content-Type: application/json" \
  -d "{\"company\":\"byte\",\"role\":\"backend\",\"level\":\"P7\",\"resumeId\":\"$RID\"}")
IV=$(echo "$CR" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('data',{}).get('interview',{}).get('id') or r.get('data',{}).get('id') or r.get('id',''))")
[ -n "$IV" ] && ok "面试 $IV" || { fail "面试创建失败: $CR"; exit 1; }

# 3. 30 轮对话（累积 history，每轮把之前所有 Q + AI 回复都传给 AI）
echo -e "\n\033[1;36m━━━ 30 轮完整对话 ━━━\033[0m"
ALL_RESPONSES="["
TOTAL_CHARS=0
FAIL_ROUNDS=0
BIZ_OK_ROUNDS=0
ROUND_TIMES=()
START=$(date +%s)

# 历史记录文件：messages.jsonl 累积每轮对话
HISTORY_FILE="$RES_DIR/messages.jsonl"
> "$HISTORY_FILE"

# Python 辅助：构造 messages JSON（包含累积 history）
build_messages_py() {
  local NEW_Q="$1"
  local IS_FINISH="$2"
  python3 <<PYEOF
import json
history = []
try:
    with open("$HISTORY_FILE") as f:
        for line in f:
            line = line.strip()
            if line:
                history.append(json.loads(line))
except FileNotFoundError:
    pass
# 追加最新 user
history.append({"role": "user", "content": "$NEW_Q"})
print(json.dumps({"messages": history, "finish": "$IS_FINISH" == "true"}))
PYEOF
}

# Python 辅助：解析 SSE 响应，提取 data: {content:...} 字段
parse_sse_py() {
  python3 <<'PYEOF'
import sys, json, re
body = sys.stdin.read()
# SSE 格式：data: {"content":"..."}\n\ndata: [DONE]\n\n
# 注：用 re.DOTALL 让 . 匹配换行；不以 \n 强制结尾
events = re.findall(r'data:\s*(\{.*?\})(?=\n\n|\ndata:|\Z)', body, re.DOTALL)
content_parts = []
err = None
done_seen = False
for ev in events:
    ev = ev.strip()
    if ev == '[DONE]':
        done_seen = True
        continue
    try:
        d = json.loads(ev)
        if 'content' in d and d['content']:
            content_parts.append(d['content'])
        if 'error' in d:
            err = d['error']
    except Exception as ex:
        pass
if content_parts:
    print('CONTENT=' + ''.join(content_parts))
elif err:
    print('ERROR=' + json.dumps(err, ensure_ascii=False))
else:
    print('EMPTY=' + body[:300])
PYEOF
}

for r in $(seq 0 $((ROUND-1))); do
  Q="${QUESTIONS[$r]}"
  IS_FINISH="false"
  [ $r -eq $((ROUND-1)) ] && IS_FINISH="true"

  # 构造带累积 history 的 payload
  PAYLOAD=$(build_messages_py "$Q" "$IS_FINISH")

  T_START=$(date +%s)
  R=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV/message" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --max-time 180 -w "\n__HTTP__:%{http_code}\n__TIME__:%{time_total}")
  T_END=$(date +%s)
  T=$((T_END-T_START))
  ROUND_TIMES+=($T)

  HTTP=$(echo "$R" | grep "__HTTP__" | sed 's/.*://')
  TIME=$(echo "$R" | grep "__TIME__" | sed 's/.*://')
  BODY=$(echo "$R" | grep -v "__HTTP__" | grep -v "__TIME__")

  # 解析 SSE（直接 inline python，不用函数）
  PARSED=$(echo "$BODY" | python3 -c '
import sys, json, re
body = sys.stdin.read()
events = re.findall(r"data:\s*(\{.*?\})(?=\n\n|\ndata:|\Z)", body, re.DOTALL)
content_parts = []
err = None
for ev in events:
    ev = ev.strip()
    if ev == "[DONE]":
        continue
    try:
        d = json.loads(ev)
        if "content" in d and d["content"]:
            content_parts.append(d["content"])
        if "error" in d:
            err = d["error"]
    except: pass
if content_parts:
    print("CONTENT=" + "".join(content_parts))
elif err:
    print("ERROR=" + json.dumps(err, ensure_ascii=False))
else:
    print("EMPTY=" + body[:200])
')
  AI_TEXT=""
  AI_ERROR=""
  if [[ "$PARSED" == CONTENT=* ]]; then
    AI_TEXT="${PARSED#CONTENT=}"
  elif [[ "$PARSED" == ERROR=* ]]; then
    AI_ERROR="${PARSED#ERROR=}"
  fi

  # P0-1 修复：判定"业务成功"必须三条件全满足
  # 1) HTTP 200
  # 2) SSE 流中无 error 事件
  # 3) AI_TEXT 不是固定 fallback "请继续介绍您的项目"
  # 4) AI_TEXT 长度 > 20（避免空响应或被截断）
  IS_AI_ERROR=0
  if [ -n "$AI_ERROR" ]; then
    IS_AI_ERROR=1
  elif [[ "$AI_TEXT" == *"请继续介绍您的项目"* ]]; then
    # P0-4 修复：fallback 静默吞错 → 标记为失败
    IS_AI_ERROR=1
    AI_ERROR="FALLBACK_PLEASE_CONTINUE"
  fi
  IS_BIZ_OK=0
  if [ "$HTTP" = "200" ] && [ $IS_AI_ERROR -eq 0 ] && [ ${#AI_TEXT} -gt 20 ]; then
    IS_BIZ_OK=1
  fi

  # P0-4 修复：error / fallback 永不写入 history（避免污染后续 AI 上下文）
  echo "{\"role\":\"user\",\"content\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$Q")}" >> "$HISTORY_FILE"
  if [ $IS_BIZ_OK -eq 1 ]; then
    echo "{\"role\":\"assistant\",\"content\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$AI_TEXT")}" >> "$HISTORY_FILE"
  fi

  # 保存
  cat > "$RES_DIR/round-$((r+1)).json" <<EOF
{
  "round": $((r+1)),
  "user_say": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$Q"),
  "ai_say": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$AI_TEXT"),
  "ai_error": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$AI_ERROR"),
  "ai_chars": ${#AI_TEXT},
  "http": $HTTP,
  "time_sec": $T,
  "is_finish": $IS_FINISH,
  "is_biz_ok": $IS_BIZ_OK,
  "is_ai_error": $IS_AI_ERROR
}
EOF

  if [ $IS_BIZ_OK -eq 1 ]; then
    echo "  [$(printf '%2d' $((r+1)))] HTTP=$HTTP T=${T}s ✓ | ${AI_TEXT:0:70}..."
    TOTAL_CHARS=$((TOTAL_CHARS+${#AI_TEXT}))
    ALL_RESPONSES+="\"$AI_TEXT\","
    BIZ_OK_ROUNDS=$((BIZ_OK_ROUNDS+1))
  else
    REASON="$([ -n "$AI_ERROR" ] && echo "ERR=${AI_ERROR:0:40}" || echo "len=${#AI_TEXT}")"
    echo "  [$(printf '%2d' $((r+1)))] HTTP=$HTTP T=${T}s ✗ | $REASON"
    FAIL_ROUNDS=$((FAIL_ROUNDS+1))
  fi

  sleep 1
done

# 移除最后一个逗号
ALL_RESPONSES="${ALL_RESPONSES%,}]"

END=$(date +%s)
DURATION=$((END-START))
AVG=$((DURATION/ROUND))

echo ""
echo "⏱  总耗时: ${DURATION}s（平均 ${AVG}s/轮）"
echo "📊 业务成功轮数: ${BIZ_OK_ROUNDS}/$ROUND （HTTP 200 + 无 STREAM_ERROR + 非 fallback）"
echo "📊 失败轮数: $FAIL_ROUNDS/$ROUND"
echo "📊 AI 总输出字符: $TOTAL_CHARS"
if [ $BIZ_OK_ROUNDS -gt 0 ]; then
  echo "📊 平均每轮字符（仅成功）: $((TOTAL_CHARS/BIZ_OK_ROUNDS))"
fi

# 4. 等待评分（finish 后 8 维度并发评分，每维度 1 次 LLM 调用，可能 30-90s）
echo -e "\n\033[1;36m━━━ 等待评分完成（最多 120s） ━━━\033[0m"
REPORT=""
SCORES_OK=0
for i in $(seq 1 24); do
  sleep 5
  REPORT=$(curl -s -b "$COOKIES" "$BASE/api/interview/$IV/report")
  if [[ "$REPORT" == *"scores"* ]] || [[ "$REPORT" == *"radar"* ]] || [[ "$REPORT" == *'"ok":true'* && "$REPORT" != *"REPORT_NOT_FOUND"* ]]; then
    SCORES_OK=1
    echo "  评分就绪（轮询 ${i} 次 × 5s = $((i*5))s）"
    break
  fi
  echo "  ⏳ 评分生成中（$((i*5))s）..."
done
echo "报告 (前 800):"
echo "$REPORT" | head -c 800
echo ""
echo "$REPORT" > "$RES_DIR/report.json"

# 解析评分
SCORE_DATA=$(echo "$REPORT" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    if isinstance(d, dict):
        scores = d.get('data',{}).get('scores') or d.get('scores')
        if scores: print(json.dumps(scores, ensure_ascii=False)[:400]); sys.exit(0)
    if d.get('ok'): print('OK:' + json.dumps(d)[:200])
except: pass
print('NO_SCORE')
" 2>/dev/null)
echo ""
echo "评分内容:"
echo "  $SCORE_DATA"

[[ "$SCORE_DATA" != "NO_SCORE" ]] && SCORES_OK=1

# 5. 汇总 — P0-1 修复：业务成功率门槛 70% 才算通过（不再看 HTTP 200 数）
echo -e "\n\033[1;36m━━━ 汇总 ━━━\033[0m"
BIZ_OK_PCT=$((BIZ_OK_ROUNDS * 100 / ROUND))
[ $BIZ_OK_PCT -ge 70 ] && ok "业务成功率 ${BIZ_OK_PCT}% ≥ 70% （${BIZ_OK_ROUNDS}/${ROUND}）" || fail "业务成功率 ${BIZ_OK_PCT}% < 70%"
[ $SCORES_OK -eq 1 ] && ok "评分报告生成" || fail "评分未生成"
[ $TOTAL_CHARS -gt 800 ] && ok "AI 输出充足 ($TOTAL_CHARS 字符)" || fail "AI 输出过少"

echo ""
echo "对话存档: $RES_DIR"
ls -la "$RES_DIR" | head -40

if [ $BIZ_OK_PCT -ge 70 ] && [ $SCORES_OK -eq 1 ] && [ $TOTAL_CHARS -gt 800 ]; then
  echo -e "\n\033[1;32m✅ 30 轮深度面试 + 评分完成 (业务成功率 ${BIZ_OK_PCT}%)\033[0m"
  # 保存面试 ID 供 Phase 14.4 评审
  echo "$IV" > "$RES_DIR/interview.id"
  echo "$EMAIL" > "$RES_DIR/email"
  echo "$RES_DIR" > "$RES_DIR/path"
  exit 0
else
  echo -e "\n\033[1;31m❌ 不通过 (BIZ_OK=${BIZ_OK_PCT}% SCORE=$SCORES_OK CHARS=$TOTAL_CHARS)\033[0m"
  echo "$IV" > "$RES_DIR/interview.id"
  echo "$EMAIL" > "$RES_DIR/email"
  echo "$RES_DIR" > "$RES_DIR/path"
  exit 1
fi
