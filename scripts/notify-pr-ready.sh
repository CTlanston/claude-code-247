#!/usr/bin/env bash
# notify-pr-ready.sh — "PR 等你 merge" 手机提醒 hook
#
# 用途：任何会话/CI/agent 开好 PR 等操作员 merge 时，调用本脚本推送 ntfy。
#   scripts/notify-pr-ready.sh <PR_URL> [标题]
#
# 配置（你的 Mac，一次性）：
#   1. 手机装 ntfy app（ntfy.sh，免费），订阅一个私有 topic，例如 aedev-lanston-7x24
#   2. 在 ~/.aedev/config.yaml 或 shell 配置加：export AEDEV_NTFY_TOPIC=aedev-lanston-7x24
#   3. （可选自托管）export AEDEV_NTFY_URL=https://你的ntfy服务器
#
# 作为 Claude Code hook（你 Mac 的 ~/.claude/settings.json）：
#   {"hooks": {"Stop": [{"hooks": [{"type": "command",
#     "command": "cd ~/projects/claude-code-247 && gh pr list --author @me --state open --json url,title --jq '.[] | \"\\(.url) \\(.title)\"' | head -1 | xargs -r -L1 scripts/notify-pr-ready.sh"}]}]}}
#   效果：每次 Claude 会话结束时，若有你名下的开放 PR，推送一条提醒。
set -euo pipefail
PR_URL="${1:?usage: notify-pr-ready.sh <PR_URL> [title]}"
TITLE="${2:-PR ready to merge}"
TOPIC="${AEDEV_NTFY_TOPIC:-}"
if [ -z "$TOPIC" ]; then
  echo "AEDEV_NTFY_TOPIC not set — printing instead of pushing:"
  echo "[$TITLE] $PR_URL"
  exit 0
fi
BASE="${AEDEV_NTFY_URL:-https://ntfy.sh}"
curl -fsS -X POST "$BASE/$TOPIC" \
  -H "Title: aedev · $TITLE" \
  -H "Priority: high" \
  -H "Click: $PR_URL" \
  -H "Tags: rocket" \
  -d "等你 merge：$PR_URL" > /dev/null
echo "notified $TOPIC"
