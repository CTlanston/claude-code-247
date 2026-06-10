#!/usr/bin/env bash
# aiw-handoff.sh — 半自动剩余-10% 循环（在操作员 Mac 上跑）
#
# 用法:
#   scripts/aiw-handoff.sh doctor     # §0 环境+成本闸+全闸基线
#   scripts/aiw-handoff.sh e2e        # §2 闭闸真实 E2E (量规 #13)
#   scripts/aiw-handoff.sh open-gate  # §3 开双闸真实 Draft PR (量规 #12)
#   scripts/aiw-handoff.sh status     # 当前量规分数 + §0 STATE
#
# 它只做"安全闸 + 跑命令 + 报告"，不替你 merge、不替你点 create-pr。
# 详见 docs/operations/OPERATOR_HANDOFF_REMAINING_10PCT.md
set -euo pipefail
cd "$(dirname "$0")/.."
SAFE_REPO="${AEDEV_REMOTE_WRITE_WHITELIST:-hermus-agent}"

doctor() {
  echo "== cost guard =="
  for k in OPENAI_API_KEY ANTHROPIC_API_KEY; do
    if [ -n "${!k:-}" ]; then echo "ABORT: $k is set — unset it (subscription CLI only)"; exit 1; fi
  done
  echo "ok: no paid API keys in env"
  echo "== CLIs =="; claude --version; codex --version; gh auth status 2>&1 | head -1
  grep -q AEDEV_GEMINI_API_KEY .env 2>/dev/null && echo "ok: gemini key in .env" || echo "WARN: add AEDEV_GEMINI_API_KEY to .env"
  echo "== gates =="; pnpm typecheck && pnpm lint && pnpm test
  echo "DOCTOR OK"
}

e2e() {
  doctor
  echo "== closed-gate real E2E (#13) =="
  unset AEDEV_ALLOW_REMOTE_WRITES || true
  AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1=1 \
  AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI=1 \
  pnpm test:cockpit:real-smoke
  echo "Report under evidence/launch/ — verify planner=claude-cli, coder=codex-cli, gemini=pass, gate=REMOTE_WRITES_DISABLED"
}

open_gate() {
  doctor
  echo "== OPEN GATE for single repo: $SAFE_REPO =="
  read -r -p "Confirm opening remote-write gate for '$SAFE_REPO' only? [yes/NO] " ans
  [ "$ans" = "yes" ] || { echo "aborted"; exit 1; }
  export AEDEV_ALLOW_REMOTE_WRITES=1
  export AEDEV_REMOTE_WRITE_WHITELIST="$SAFE_REPO"
  echo "Gate open. Now start the cockpit and drive a real mission:"
  echo "  pnpm tsx scripts/dev-operator-cockpit.ts"
  echo "Expect: Claude review bubble, Gemini PASS, a REAL draft PR URL."
  echo "Merge stays manual. Rollback: unset AEDEV_ALLOW_REMOTE_WRITES."
}

status() {
  echo "== rubric =="; grep -E '当前分数|score' docs/E2E_ACCEPTANCE_RUBRIC.md || true
  echo "== workbook §0 =="; sed -n '/^## §0/,/```$/p' WORKBOOK_v4.md | sed -n '1,20p'
}

case "${1:-status}" in
  doctor) doctor ;;
  e2e) e2e ;;
  open-gate) open_gate ;;
  status) status ;;
  *) echo "usage: $0 {doctor|e2e|open-gate|status}"; exit 1 ;;
esac
