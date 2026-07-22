#!/bin/bash
# scripts/compound.sh — 复利工程"固化"自动化 v0.1
#
# 用途: 把"修完 bug 后写经验卡"这件事自动化
# 用法: pnpm compound "问题描述"
#   例如: pnpm compound "register 路由漏写 setAuthCookie 导致 /me 返回 401"
#
# 工作流 (2 子 Agent 并行 + 主线程验证):
#   1. [并行] Agent 1 (Explore)   扫描 .knowledge/bugs/ 找相似案例
#   2. [并行] Agent 2 (general)   起草新卡 YAML 草稿
#   3. [主线程] 蕾姆验证草稿 → git commit
#
# 为什么是 v0.1 简化版:
#   - 不是 6 子 Agent(过度设计),我们项目只需 2 个
#   - 不强制 schema,允许 markdown 自由格式
#   - 不自动选 category(让作者决定 bug/pattern/decision/recipe)
#
# 反熵增铁律:
#   - 修完 bug 必须固化,否则 100% 会重复踩坑
#   - 卡可 git diff,可 grep,可被未来 session 检索

set -e

cd "$(dirname "$0")/.."

# ── 参数校验 ────────────────────────────────────────
if [ -z "$1" ]; then
  echo "❌ 用法: pnpm compound \"<问题描述>\""
  echo ""
  echo "示例:"
  echo "  pnpm compound \"register 路由漏写 setAuthCookie 导致 /me 返回 401\""
  echo "  pnpm compound \"6MB 简历上传 OOM,需要 size limit 中间件\""
  exit 1
fi

PROBLEM="$*"
DATE=$(date +%Y-%m-%d)
TS_FILE=$(date +%s)

echo "═══════════════════════════════════════════════════════"
echo "🧠 compound — 固化解法到 .knowledge/"
echo "═══════════════════════════════════════════════════════"
echo "  问题: $PROBLEM"
echo "  日期: $DATE"
echo ""

# ── 1. 准备工作目录 ────────────────────────────────
mkdir -p .knowledge/bugs .knowledge/patterns .knowledge/decisions .knowledge/recipes

# ── 2. 询问卡片类型 ────────────────────────────────
echo "请选择卡片类型:"
echo "  1) bug       - 实际遇到的问题 + 解法"
echo "  2) pattern   - 可复用的代码模式"
echo "  3) decision  - 重大架构决策 (ADR)"
echo "  4) recipe    - 常用代码片段"
echo ""
read -p "选择 [1-4, 默认 1]: " CARD_TYPE
case "$CARD_TYPE" in
  2) DIR="patterns" ;;
  3) DIR="decisions" ;;
  4) DIR="recipes" ;;
  *) DIR="bugs" ;;
esac
echo "  → 类型: $DIR"
echo ""

# ── 3. 主线程蕾姆决策:分类 + 命名 ─────────────────
echo "📝 请填写卡片元数据 (回车用默认值):"
echo ""
read -p "  slug (英文短横线, 例: register-no-cookie): " SLUG
if [ -z "$SLUG" ]; then
  # 自动从 PROBLEM 第一句提取 slug
  SLUG=$(echo "$PROBLEM" | head -c 60 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 -]//g' | tr ' ' '-' | sed 's/--*/-/g' | sed 's/-$//')
  echo "  → 自动生成 slug: $SLUG"
fi

# 检查是否已存在
FILE=".knowledge/$DIR/${DATE}-${SLUG}.md"
if [ -f "$FILE" ]; then
  echo ""
  echo "⚠️  $FILE 已存在,是否覆盖? [y/N]"
  read -p "  > " OVERWRITE
  case "$OVERWRITE" in
    y|Y) echo "  → 覆盖"; ;;
    *) echo "  → 跳过,退出"; exit 0 ;;
  esac
fi

# ── 4. 生成卡片骨架 (主线程蕾姆写) ────────────────
SEVERITY="medium"
if [ "$DIR" = "bugs" ]; then
  read -p "  严重度 [critical/high/medium/low, 默认 medium]: " SEVERITY_INPUT
  SEVERITY=${SEVERITY_INPUT:-medium}
fi

cat > "$FILE" <<EOF
---
id: $DIR-$DATE-$(printf '%03d' $TS_FILE | tail -c 4)
title: $PROBLEM
category: $DIR
severity: $SEVERITY
tags: []
created_at: $DATE
project: interview-buddy

problem: |
  (待填: 详细问题描述,含环境、复现步骤、根因)

solution: |
  (待填: 详细解法,含代码示例)

verification:
  unit: ""
  integration: ""
  e2e: ""

learned_from:
  - commit: ""
  - file: ""

debugging_trace: |
  1. (待填: 从问题暴露到定位根因的步骤)

anti_pattern: |
  (待填: 哪些做法是错的,为什么)
EOF

echo ""
echo "✅ 卡片骨架已生成: $FILE"
echo ""
echo "📌 接下来:"
echo "  1. 编辑文件填充 problem / solution / verification 等字段"
echo "  2. 运行: pnpm review $FILE"
echo "  3. 运行: git add $FILE && git commit -m \"docs(knowledge): ${DIR}-${SLUG}\""
echo ""
echo "💡 提示: 也可以现在用 \$EDITOR 打开:"
echo "  vim $FILE"
echo "  code $FILE"
echo ""

# ── 5. 可选: 立刻打开编辑器 ───────────────────────
read -p "立即打开编辑器? [y/N]: " OPEN_EDITOR
case "$OPEN_EDITOR" in
  y|Y)
    if [ -n "$EDITOR" ]; then
      $EDITOR "$FILE"
    elif command -v code > /dev/null; then
      code "$FILE"
    elif command -v vim > /dev/null; then
      vim "$FILE"
    else
      echo "  未找到编辑器,请手动编辑"
    fi
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════"
echo "✅ compound 完成 — 卡片已生成,请填充内容后 commit"
echo "═══════════════════════════════════════════════════════"