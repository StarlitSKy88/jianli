#!/usr/bin/env bash
# Phase 13.6: 真实 AI provider 快速冒烟测试
# 不依赖 mock provider，验证真实 OPENROUTER/MiniMax/Claude/DeepSeek 是否能跑通
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
RES_DIR="./.stress13.6-r-$$"
mkdir -p "$RES_DIR"
COOKIES="$RES_DIR/cookies.txt"

PASS=0; FAIL=0
check() {
  local name="$1" cond="$2" detail="$3"
  if [ "$cond" = "1" ]; then
    echo "  ✅ $name — $detail"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name — $detail"
    FAIL=$((FAIL+1))
  fi
}

echo -e "\033[1;36m━━━ Phase 13.6: 真实 AI provider 冒烟 ━━━\033[0m"

# 1) 准备用户
EMAIL="ai-test-$(date +%s)-$$@taomyst.top"
PW="Test1234!"

cat > "$RES_DIR/seed-user.js" <<'NODE_EOF'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
// process.argv = [node, script, email, password]
const email = process.argv[2];
const password = process.argv[3];
const p = new PrismaClient();
(async () => {
  const existing = await p.user.findUnique({ where: { email } });
  // 如果已注册且有密码，复用最近一次验证码（如果还存在）
  if (existing && existing.passwordHash && existing.passwordHash.length > 0) {
    if (existing.verifyCode && existing.verifyExpiry && existing.verifyExpiry.getTime() > Date.now()) {
      console.log('VERIFICATION_CODE=' + existing.verifyCode);
    } else {
      // 已注册但 verifyCode 已失效 — 重新发一个（不消耗，不动 passwordHash）
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await p.user.update({ where: { id: existing.id }, data: { verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) } });
      console.log('VERIFICATION_CODE=' + code);
    }
    await p.$disconnect();
    return;
  }
  // 新建 pending user + 设置 verifyCode
  // pending user 必须 passwordHash='' 占位（让 register 流程还能看到 EMAIL_TAKEN=false）
  // 真正 hash 由 register 路由调 consumeVerifyCode OK 后写入
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await p.user.upsert({
    where: { email },
    // update 不重设 passwordHash：避免污染已注册用户导致注册接口误判 EMAIL_TAKEN
    // 只刷 verifyCode；create 时才设 占位空 hash（不是真 hash！）
    update: { verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) },
    create: { email, passwordHash: '', verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000), emailVerified: false },
  });
  console.log('VERIFICATION_CODE=' + code);
  await p.$disconnect();
})().catch((e) => { console.error('ERR=' + e.message); process.exit(1); });
NODE_EOF

DBURL="$(grep DATABASE_URL .env.local | sed 's/DATABASE_URL="//;s/"$//')"
SEED=$(DATABASE_URL="$DBURL" node "$RES_DIR/seed-user.js" "$EMAIL" "$PW" 2>&1)
CODE=$(echo "$SEED" | grep -oE 'VERIFICATION_CODE=[0-9]+' | head -1 | sed 's/VERIFICATION_CODE=//')

REG=$(curl -s -c "$COOKIES" -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"verifyCode\":\"$CODE\"}")
echo "  register: $(echo "$REG" | head -c 80)"

# 如 register 失败（EMAIL_TAKEN 等），用 login 兜底
if echo "$REG" | grep -q '"ok":false'; then
  echo "  (register 失败，转 login)"
  curl -s -c "$COOKIES" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" -o /dev/null
else
  # register 成功也单独 login 一次确保 cookie 完整
  rm -f "$COOKIES"
  curl -s -c "$COOKIES" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" -o /dev/null
fi
# 校验 cookie 是否拿到
HAS_COOKIE=$(grep -E "session|token" "$COOKIES" 2>/dev/null | wc -l | tr -d ' ')
echo "  cookie 行数: $HAS_COOKIE"

# 充值 + 创建面试
cat > "$RES_DIR/charge.js" <<'NODE_EOF'
const { PrismaClient } = require('@prisma/client');
const email = process.argv[2];
const p = new PrismaClient();
(async () => {
  await p.user.update({ where: { email }, data: { paidQuota: 100 } });
  console.log('OK');
  await p.$disconnect();
})();
NODE_EOF
DATABASE_URL="$DBURL" node "$RES_DIR/charge.js" "$EMAIL" 2>&1 | tail -1

# 上传简历
echo "test resume content - $(date)" > "$RES_DIR/resume.txt"
RESUME=$(curl -s -b "$COOKIES" -X POST "$BASE/api/resume/upload" \
  -F "file=@$RES_DIR/resume.txt;type=text/plain")
RID=$(echo "$RESUME" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('resume') or {}).get('id',''))")
echo "  resume: $RID"

# 获取一个 byte 场景（role 列是 backend 小写，不是 BACKEND）
SCEN=$(DATABASE_URL="$DBURL" node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const s = await p.scenario.findFirst({ where: { company: 'byte', role: 'backend' } });
  console.log((s?.company || 'none') + '|' + (s?.role || '') + '|' + (s?.level || 'p5'));
  await p.\$disconnect();
})();
" 2>&1 | grep -E '^(byte|none)\|' | head -1)
echo "  scenario: $SCEN"
SCR_COMPANY=$(echo "$SCEN" | cut -d'|' -f1)
SCR_ROLE=$(echo "$SCEN" | cut -d'|' -f2)
SCR_LEVEL=$(echo "$SCEN" | cut -d'|' -f3)
[ "$SCR_COMPANY" = "none" ] && { echo "  ❌ 无 byte/backend scenario"; exit 1; }

# 创建面试（注意：/api/interview 路由要求 company/role/level/resumeId，不是 scenarioId）
CREATE=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview" \
  -H "Content-Type: application/json" \
  -d "{\"company\":\"$SCR_COMPANY\",\"role\":\"$SCR_ROLE\",\"level\":\"$SCR_LEVEL\",\"resumeId\":\"$RID\"}")
echo "  create raw: $(echo $CREATE | head -c 150)"
IV=$(echo "$CREATE" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('id','') or (d.get('interview') or {}).get('id',''))")
echo "  interview: $IV"

# 2) 单轮真实 AI 测试
echo -e "\n→ 单轮真实 AI 测试（最多等 60s）"
PAYLOAD='{"messages":[{"role":"user","content":"你好，请做个自我介绍"}],"finish":false}'
T_START=$(date +%s)
R=$(curl -s -b "$COOKIES" -X POST "$BASE/api/interview/$IV/message" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" --max-time 60 -w "\n__HTTP__:%{http_code}\n__TIME__:%{time_total}")
T_END=$(date +%s)
HTTP=$(echo "$R" | grep "__HTTP__" | sed 's/.*://')
BODY=$(echo "$R" | grep -v "__HTTP__" | grep -v "__TIME__")
echo "  HTTP=$HTTP  T=$((T_END-T_START))s"
echo "  body前200: $(echo "$BODY" | head -c 200)..."

AI_TEXT=$(echo "$BODY" | python3 -c '
import sys, json, re
body = sys.stdin.read()
events = re.findall(r"data:\s*(\{.*?\})(?=\n\n|\ndata:|\Z)", body, re.DOTALL)
parts = []
for ev in events:
    try:
        d = json.loads(ev)
        if "content" in d and d["content"]: parts.append(d["content"])
    except: pass
print("".join(parts))
')

check "HTTP 200" "$([ "$HTTP" = "200" ] && echo 1 || echo 0)" "HTTP=$HTTP"
check "AI 返回非空" "$([ ${#AI_TEXT} -gt 20 ] && echo 1 || echo 0)" "len=${#AI_TEXT}"
check "不是 fallback" "$([[ "$AI_TEXT" == *"请继续介绍"* ]] && echo 0 || echo 1)" "ai_text='${AI_TEXT:0:40}...'"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 通过 $PASS / 共 $((PASS+FAIL))"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAIL" = "0" ] && exit 0 || exit 1