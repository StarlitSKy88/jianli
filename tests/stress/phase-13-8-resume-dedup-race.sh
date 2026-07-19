#!/usr/bin/env bash
# Phase 13.8: Resume upload dedup race condition 验证
#
# 场景：两个不同 user 顺序上传完全相同的文件
# 期望：第二个 user 拿到 deduplicated=true（不返回 500）
# bug：第二个 user 触发 P2002 race condition 返回 500
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
RES_DIR="./.stress13.8-r-$$"
mkdir -p "$RES_DIR"
COOKIES_A="$RES_DIR/cookies-a.txt"
COOKIES_B="$RES_DIR/cookies-b.txt"

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

echo -e "\033[1;36m━━━ Phase 13.8: Resume upload race condition 验证 ━━━\033[0m"

# 创建 seed-user.js（与 phase-14-2 一致）
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
      update: { passwordHash, verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) },
      create: { email, passwordHash, verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) },
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
EMAIL_A="race-a-$(date +%s)-$$@taomyst.top"
EMAIL_B="race-b-$(date +%s)-$$@taomyst.top"
PW="Test1234!"

# === User A ===
echo "→ 准备 user A: $EMAIL_A"
SEED_A=$(DATABASE_URL="$DBURL" node "$RES_DIR/seed-user.js" "$EMAIL_A" "$PW" 2>&1)
CODE_A=$(echo "$SEED_A" | grep -oE 'CODE=[0-9]+' | tail -1 | sed 's/CODE=//')
REG_A=$(curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PW\",\"verifyCode\":\"$CODE_A\"}")
LOGIN_A=$(curl -s -c "$COOKIES_A" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PW\"}")
USER_A_ID=$(echo "$LOGIN_A" | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('userId',''))")
echo "  user A id: $USER_A_ID"

# === User B ===
echo "→ 准备 user B: $EMAIL_B"
SEED_B=$(DATABASE_URL="$DBURL" node "$RES_DIR/seed-user.js" "$EMAIL_B" "$PW" 2>&1)
CODE_B=$(echo "$SEED_B" | grep -oE 'CODE=[0-9]+' | tail -1 | sed 's/CODE=//')
REG_B=$(curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"$PW\",\"verifyCode\":\"$CODE_B\"}")
LOGIN_B=$(curl -s -c "$COOKIES_B" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"$PW\"}")
USER_B_ID=$(echo "$LOGIN_B" | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('userId',''))")
echo "  user B id: $USER_B_ID"

# 准备相同文件
echo "test resume content - $(date)" > "$RES_DIR/resume.txt"
FILE_HASH=$(shasum -a 256 "$RES_DIR/resume.txt" | awk '{print $1}')
echo "  file hash: $FILE_HASH"

# === User A 上传 ===
echo -e "\n→ User A 上传"
UPLOAD_A=$(curl -s -b "$COOKIES_A" -X POST "$BASE/api/resume/upload" \
  -F "file=@$RES_DIR/resume.txt;type=text/plain" -w "\n__HTTP__:%{http_code}")
HTTP_A=$(echo "$UPLOAD_A" | grep "__HTTP__" | sed 's/.*://')
BODY_A=$(echo "$UPLOAD_A" | grep -v "__HTTP__")
RESUME_A_ID=$(echo "$BODY_A" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('resume') or {}).get('id',''))" 2>/dev/null)
echo "  HTTP=$HTTP_A  resumeId=$RESUME_A_ID"
check "A 上传成功" "$([ "$HTTP_A" = "200" ] && [ -n "$RESUME_A_ID" ] && echo 1 || echo 0)" "HTTP=$HTTP_A"

# === User B 上传相同文件（关键场景：不同 user 同 fileHash）===
echo -e "\n→ User B 上传同 hash 文件（验证 race fix / 跨用户去重）"
UPLOAD_B=$(curl -s -b "$COOKIES_B" -X POST "$BASE/api/resume/upload" \
  -F "file=@$RES_DIR/resume.txt;type=text/plain" -w "\n__HTTP__:%{http_code}")
HTTP_B=$(echo "$UPLOAD_B" | grep "__HTTP__" | sed 's/.*://')
BODY_B=$(echo "$UPLOAD_B" | grep -v "__HTTP__")
echo "  HTTP=$HTTP_B"
echo "  body: $(echo "$BODY_B" | head -c 300)..."
RESUME_B_ID=$(echo "$BODY_B" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('resume') or {}).get('id',''))" 2>/dev/null)
DEDUP_B=$(echo "$BODY_B" | python3 -c "import sys,json;print(json.load(sys.stdin).get('deduplicated',''))" 2>/dev/null)

check "B 上传不报错" "$([ "$HTTP_B" = "200" ] && echo 1 || echo 0)" "HTTP=$HTTP_B"
check "B 拿到 resume" "$([ -n "$RESUME_B_ID" ] && echo 1 || echo 0)" "resumeId=$RESUME_B_ID"

# === 同一用户再次上传（核心 dedup 场景）===
echo -e "\n→ User A 重复上传同 hash（验证同用户去重）"
UPLOAD_A2=$(curl -s -b "$COOKIES_A" -X POST "$BASE/api/resume/upload" \
  -F "file=@$RES_DIR/resume.txt;type=text/plain" -w "\n__HTTP__:%{http_code}")
HTTP_A2=$(echo "$UPLOAD_A2" | grep "__HTTP__" | sed 's/.*://')
BODY_A2=$(echo "$UPLOAD_A2" | grep -v "__HTTP__")
DEDUP_A2=$(echo "$BODY_A2" | python3 -c "import sys,json;print(json.load(sys.stdin).get('deduplicated',''))" 2>/dev/null)
echo "  HTTP=$HTTP_A2 deduplicated=$DEDUP_A2"
check "A 重复上传去重" "$([ "$HTTP_A2" = "200" ] && [ "$DEDUP_A2" = "True" ] && echo 1 || echo 0)" \
  "HTTP=$HTTP_A2 dedup=$DEDUP_A2"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 通过 $PASS / 共 $((PASS+FAIL))"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAIL" = "0" ] && exit 0 || exit 1