#!/usr/bin/env bash
# NEXT_PLAN_WORKBOOK §3 Phase L2.4 — Secondary-machine cold standby install.
#
# Brings up claude-code-247 v2.2.x on a fresh Linux host (or any
# unix-like machine with bash + node + git) as a COLD STANDBY:
# code installed, daemon NOT running, smoke checks ready to run.
#
# Activation (when primary fails) is a separate operator decision —
# this script only gets the standby to "ready to boot in <30 min".
#
# Usage:
#   scripts/handoff/secondary-install.sh [--prefix DIR] [--branch REF] [--dry-run]
#
# Defaults:
#   prefix = ~/projects/claude-code-247
#   branch = main
#
# Idempotent — re-running on an already-installed prefix updates instead
# of failing. Never destroys ~/.claude-code-247/ state.

set -Eeuo pipefail

PREFIX="${HOME}/projects/claude-code-247"
BRANCH="main"
DRY_RUN=0
REPO_URL="https://github.com/CTlanston/claude-code-247.git"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)  PREFIX="$2"; shift 2;;
    --branch)  BRANCH="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

run() {
  echo "+ $*"
  if [[ $DRY_RUN -eq 0 ]]; then
    "$@"
  fi
}

echo "==> secondary install · prefix=$PREFIX branch=$BRANCH dry=$DRY_RUN"

# --- Step 1: prerequisites
echo "==> [1/6] checking prerequisites"
for cmd in git node pnpm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing: $cmd" >&2
    echo "Install with your platform package manager and re-run." >&2
    exit 3
  fi
done
node_major=$(node -p 'process.versions.node.split(".")[0]')
if [[ "$node_major" -lt 20 ]]; then
  echo "node major version ($node_major) < 20 required" >&2
  exit 3
fi

# --- Step 2: fetch repo
echo "==> [2/6] fetching repo into $PREFIX"
if [[ -d "$PREFIX/.git" ]]; then
  run git -C "$PREFIX" fetch origin --tags
  run git -C "$PREFIX" checkout "$BRANCH"
  run git -C "$PREFIX" pull --ff-only origin "$BRANCH"
else
  run git clone --branch "$BRANCH" "$REPO_URL" "$PREFIX"
fi

# --- Step 3: install deps
echo "==> [3/6] pnpm install"
run cd "$PREFIX"
run pnpm install --frozen-lockfile

# --- Step 4: typecheck + tests (catches platform deltas, not regressions)
echo "==> [4/6] pnpm typecheck + vitest"
run pnpm --dir "$PREFIX" typecheck
run pnpm --dir "$PREFIX" vitest run

# --- Step 5: provision local state dir (idempotent; never overwrites)
echo "==> [5/6] provisioning ~/.claude-code-247/ (idempotent)"
state_dir="${HOME}/.claude-code-247"
if [[ ! -d "$state_dir" ]]; then
  run mkdir -p "$state_dir/logs" "$state_dir/state/backups" "$state_dir/workspaces" "$state_dir/memory"
  echo "    fresh state dir created at $state_dir"
else
  echo "    existing state dir found at $state_dir — NOT touched"
fi

# --- Step 6: run synthetic smoke to confirm the install
echo "==> [6/6] launch-smoke (synthetic dry-run)"
run pnpm --dir "$PREFIX" tsx scripts/launch-smoke.ts --synthetic

echo ""
echo "==> standby ready"
echo "   To activate:"
echo "     1. operator copies plist:    cp $PREFIX/scripts/launchd/com.claude247.daemon.plist.tpl ..."
echo "        (Linux: systemctl --user enable; see packages/supervisor)"
echo "     2. operator confirms secrets at \$HOME/.claude-code-247/with-secrets"
echo "     3. operator runs the REAL smoke:"
echo "          cd $PREFIX && pnpm tsx scripts/launch-smoke.ts"
echo "     4. if 7/7 → mesh.enabled=true; operator on call (NEXT_PLAN_WORKBOOK §3 L0 G1)"
echo ""
echo "   This script DID NOT start the daemon. Cold standby only."
