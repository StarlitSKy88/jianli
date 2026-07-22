#!/bin/bash
# scripts/review.sh — 并行审查 v0.1 (简化版,2-4 个 agent)
#
# 用途: 派 2-4 个 subagent 并行审查指定文件/路径
# 用法: pnpm review <path>
#   例如: pnpm review app/api/auth/register/route.ts
#         pnpm review app/api/payment/
#
# 触发规则 (按文件类型自动选 agent 组合):
#   - lib/auth/** 或 app/api/auth/** 或 app/api/payment/**
#     → code-reviewer + security-reviewer (2 个)
#   - lib/scoring/** 或 lib/ai/**
#     → code-reviewer + tdd-guide (2 个)
#   - 其他代码
#     → code-reviewer (1 个,主线程自己也审)
#   - 显式 --deep
#     → code-reviewer + security-reviewer + tdd-guide + refactor-cleaner (4 个)
#
# 输出: 在 stdout 打印每个 agent 的审查报告,主线程负责汇总
#
# 为什么是 v0.1 简化版:
#   - 我们项目 22 个 API 路由,不需要 14 个 reviewer
#   - 80% 的改动用 code-reviewer 单个就够
#   - 鉴权/payment/AI 才需要 security/tdd 加强
#
# 真实情况:
#   - 这个脚本是"命令门面",实际派 agent 由 Claude Code 主循环完成
#   - 脚本本身只做"决策 + 打印 plan"
#   - 用户复制 plan 给主对话,主对话派 subagent

set -e

cd "$(dirname "$0")/.."

# ── 参数解析 ────────────────────────────────────────
DEEP=0
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --deep) DEEP=1; shift ;;
    -h|--help)
      echo "用法: pnpm review <path> [--deep]"
      echo ""
      echo "  --deep  强制派 4 个 agent(覆盖默认规则)"
      echo ""
      echo "示例:"
      echo "  pnpm review app/api/auth/register/route.ts"
      echo "  pnpm review lib/scoring/scorer.ts --deep"
      exit 0
      ;;
    *) TARGET="$1"; shift ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "❌ 用法: pnpm review <path> [--deep]"
  exit 1
fi

if [ ! -e "$TARGET" ]; then
  echo "❌ 路径不存在: $TARGET"
  exit 1
fi

# ── 决策:派哪几个 agent ────────────────────────────
AGENTS=()
PROFILES=()

if [ $DEEP -eq 1 ]; then
  AGENTS=(code-reviewer security-reviewer tdd-guide refactor-cleaner)
  PROFILES=(
    "代码质量、可读性、命名、错误处理"
    "OWASP Top 10、安全漏洞、auth/payment 风险"
    "测试覆盖、TDD 合规、边界用例"
    "死代码、重复代码、可清理的废弃模块"
  )
elif [[ "$TARGET" == *"/auth/"* ]] || [[ "$TARGET" == *"/payment/"* ]]; then
  AGENTS=(code-reviewer security-reviewer)
  PROFILES=(
    "代码质量、可读性、错误处理"
    "OWASP Top 10、注入、权限绕过"
  )
elif [[ "$TARGET" == *"/scoring/"* ]] || [[ "$TARGET" == *"/ai/"* ]]; then
  AGENTS=(code-reviewer tdd-guide)
  PROFILES=(
    "代码质量、可读性、AI prompt 风险"
    "测试覆盖、评分边界、漂移检测"
  )
else
  AGENTS=(code-reviewer)
  PROFILES=("代码质量、可读性、命名、错误处理、复杂度")
fi

echo "═══════════════════════════════════════════════════════"
echo "🔍 review — 并行审查 $TARGET"
echo "═══════════════════════════════════════════════════════"
echo "  模式: $([ $DEEP -eq 1 ] && echo 'deep (强制 4 agent)' || echo 'auto (按路径智能选)')"
echo "  Agent 数: ${#AGENTS[@]}"
echo ""
echo "📋 审查计划:"
for i in "${!AGENTS[@]}"; do
  echo "  $((i+1)). [${AGENTS[$i]}] → ${PROFILES[$i]}"
done
echo ""
echo "═══════════════════════════════════════════════════════"
echo "🚀 下一步:把以下 prompt 发给主对话执行"
echo "═══════════════════════════════════════════════════════"
echo ""
cat <<EOF
请对 $TARGET 并行派 ${#AGENTS[@]} 个 subagent 做独立审查,
每个 agent 独立完成,不互相依赖,最后我汇总报告:

EOF

for i in "${!AGENTS[@]}"; do
  cat <<EOF
### Agent $((i+1)): ${AGENTS[$i]}
任务:审查 $TARGET
重点:${PROFILES[$i]}
输出格式:
- 严重度:CRITICAL/HIGH/MEDIUM/LOW
- 文件:行号
- 问题描述
- 修复建议
(最多列 5 个最严重的问题)

EOF
done

echo "═══════════════════════════════════════════════════════"
echo "💡 提示:"
echo "  - 复制上面整段给主对话即可触发并行审查"
echo "  - 主对话会自动派 ${#AGENTS[@]} 个 subagent 并行执行"
echo "  - 审查完成后,主线程汇总 + 决定是否修复"
echo ""
echo "  或直接运行 pnpm elf-g \"审查 $TARGET\" 一键全流程"