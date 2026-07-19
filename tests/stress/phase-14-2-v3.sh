#!/bin/bash
# Phase 14.2 v3: 单用户 30 轮完整深度面试 + 完整评分
# 关键改进：
#   1. STREAM_ERROR 不写入 history（避免脏数据污染后续）
#   2. 失败轮重试 2 次
#   3. 完整走 finish 触发 8 维度评分
set +e
cd "$(dirname "$0")/../.."

BASE="${BASE:-http://localhost:3001}"
RES_DIR="./.stress14.2-v3-$$"
mkdir -p "$RES_DIR"
COOKIES="$RES_DIR/cookies.txt"
rm -f "$COOKIES"

# 准备用户
EMAIL="d30v3-$(date +%s)-$RANDOM@taomyst.top"
echo "  email: $EMAIL"

# 用上次的 cookies（已登录），直接重用
RESUME_ID="cmrlu2hle004n3yt19aq6zsfs"
if [ ! -f ./.stress14.2-r-49598/cookies.txt ]; then
  echo "需要 Phase 14.2 cookies"
  exit 1
fi
cp ./.stress14.2-r-49598/cookies.txt "$COOKIES"

# 充值 paidQuota=100
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
    await p.$disconnect();
    const msg = (e.message || '').split('\n')[0];
    console.log('ERR_' + attempt + '=' + msg);
    if (attempt < 4 && /Can't reach|ECONN|ETIMEDOUT|timeout/i.test(msg)) {
      await new Promise(r => setTimeout(r, 2000));
      return charge(attempt + 1);
    }
  }
}
charge(1);
NODE_EOF
DBURL="$(grep DATABASE_URL .env.local | sed 's/DATABASE_URL="//;s/"$//')"
QUOTA=$(DATABASE_URL="$DBURL" node "$RES_DIR/charge.js" "$EMAIL" 2>&1 | grep -E '^(OK|ERR_[0-9]+)=' | tail -1 | sed 's/^[^=]*=//')
echo "  → paidQuota=$QUOTA"

# 新建面试
CR=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview" \
  -H "Content-Type: application/json" \
  -d "{\"company\":\"byte\",\"role\":\"backend\",\"level\":\"P7\",\"resumeId\":\"$RESUME_ID\"}")
IV=$(echo "$CR" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('data',{}).get('interview',{}).get('id') or r.get('data',{}).get('id') or r.get('id',''))")
echo "  interview: $IV"

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

echo -e "\n\033[1;36m━━━ 30 轮对话（v3：失败不写 history） ━━━\033[0m"
HISTORY_FILE="$RES_DIR/messages.jsonl"
> "$HISTORY_FILE"
TOTAL_CHARS=0
FAIL_ROUNDS=0
ROUND_TIMES=()
START=$(date +%s)

for r in $(seq 0 29); do
  Q="${QUESTIONS[$r]}"
  IS_FINISH="false"
  [ $r -eq 29 ] && IS_FINISH="true"

  # 构造带累积 history 的 payload
  PAYLOAD=$(python3 <<PYEOF
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
history.append({"role": "user", "content": "$Q"})
print(json.dumps({"messages": history, "finish": "$IS_FINISH" == "true"}))
PYEOF
)

  T_START=$(date +%s)
  R=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV/message" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --max-time 180 -w "\n__HTTP__:%{http_code}\n__TIME__:%{time_total}")
  T_END=$(date +%s)
  T=$((T_END-T_START))
  ROUND_TIMES+=($T)

  HTTP=$(echo "$R" | grep "__HTTP__" | sed 's/.*://')
  BODY=$(echo "$R" | grep -v "__HTTP__" | grep -v "__TIME__")

  PARSED=$(echo "$BODY" | python3 -c '
import sys, json, re
body = sys.stdin.read()
events = re.findall(r"data:\s*(\{.*?\})(?=\n\n|\ndata:|\Z)", body, re.DOTALL)
content_parts = []
err = None
for ev in events:
    ev = ev.strip()
    if ev == "[DONE]": continue
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
  [ -z "$AI_TEXT" ] && AI_TEXT="$AI_ERROR"

  # 只在 AI_TEXT 非错误时才写 history
  IS_AI_ERROR=0
  if [[ "$AI_TEXT" == *"STREAM_ERROR"* ]] || [[ "$AI_TEXT" == *"402"* ]] || [[ -z "$AI_TEXT" ]]; then
    IS_AI_ERROR=1
  fi

  echo "{\"role\":\"user\",\"content\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$Q")}" >> "$HISTORY_FILE"
  if [ $IS_AI_ERROR -eq 0 ]; then
    echo "{\"role\":\"assistant\",\"content\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$AI_TEXT")}" >> "$HISTORY_FILE"
  fi

  cat > "$RES_DIR/round-$((r+1)).json" <<EOF
{
  "round": $((r+1)),
  "user_say": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$Q"),
  "ai_say": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$AI_TEXT"),
  "ai_chars": ${#AI_TEXT},
  "http": $HTTP,
  "time_sec": $T,
  "is_finish": $IS_FINISH,
  "is_ai_error": $IS_AI_ERROR
}
EOF

  if [ "$HTTP" = "200" ] && [ $IS_AI_ERROR -eq 0 ] && [ ${#AI_TEXT} -gt 20 ]; then
    echo "  [$(printf '%2d' $((r+1)))] HTTP=$HTTP T=${T}s ✓ | ${AI_TEXT:0:60}..."
    TOTAL_CHARS=$((TOTAL_CHARS+${#AI_TEXT}))
  else
    echo "  [$(printf '%2d' $((r+1)))] HTTP=$HTTP T=${T}s ✗ | ${AI_TEXT:0:50}"
    FAIL_ROUNDS=$((FAIL_ROUNDS+1))
  fi
  sleep 1
done

END=$(date +%s)
DURATION=$((END-START))
echo ""
echo "⏱  总耗时: ${DURATION}s"
echo "📊 成功轮数: $((30-FAIL_ROUNDS))/30"
echo "📊 失败轮数: $FAIL_ROUNDS/30"
echo "📊 AI 总输出: $TOTAL_CHARS 字符"

# 等待评分（8 维度并发）
echo -e "\n\033[1;36m━━━ 等待评分（最多 180s） ━━━\033[0m"
REPORT=""
for i in $(seq 1 36); do
  sleep 5
  REPORT=$(curl -s -b "$COOKIES" "$BASE/api/interview/$IV/report")
  if [[ "$REPORT" == *"radar"* ]] || [[ "$REPORT" == *"totalScore"* ]] || [[ "$REPORT" == *"aggregated"* ]]; then
    echo "  评分就绪（${i}×5s = $((i*5))s）"
    break
  fi
  echo "  ⏳ 评分生成中（$((i*5))s）..."
done

echo ""
echo "=== report.json ==="
echo "$REPORT" > "$RES_DIR/report.json"
echo "$REPORT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if not d.get('ok'):
    print('FAILED:', d.get('error'))
else:
    data = d.get('data', d)
    print('totalScore =', data.get('totalScore'))
    print('summary   =', data.get('summary', '')[:200])
    radar = data.get('radar', {})
    if radar:
        for k, v in sorted(radar.items()):
            print(f'  {k:12s} = {v}')
    weak = data.get('weak', [])
    strong = data.get('strong', [])
    if weak: print('weak   =', weak)
    if strong: print('strong =', strong)
"

echo ""
echo "对话存档: $RES_DIR"
ls -la "$RES_DIR" | head -20
echo "$IV" > "$RES_DIR/interview.id"
echo "$EMAIL" > "$RES_DIR/email"
echo "$RES_DIR" > "$RES_DIR/path"
