#!/usr/bin/env bash
# spawn_worktree.sh — Track C2-init helper (Cycle 17, ADR-0008-adjacent).
#
# Idempotently create a git worktree at `worktrees/<name>` on a fresh
# branch `autoevo/worktree-<name>`. If the worktree path already exists
# (e.g. a previous spawn or rollback artifact), this is a no-op — the
# script reports the existing worktree's branch and exits 0.
#
# Usage:
#   scripts/spawn_worktree.sh <name>
#   scripts/spawn_worktree.sh stream-1
#
# Constraints (L7 §0):
# - NEVER runs `git push`
# - NEVER touches main branch
# - Always uses `autoevo/worktree-*` prefix to keep these branches
#   separate from cycle branches (`autoevo/cycle-*`)
# - The `worktrees/` directory is gitignored at repo root

set -u
set -e

if [ $# -lt 1 ]; then
  echo "usage: $0 <name>" >&2
  exit 64
fi

NAME="$1"
WT_DIR="worktrees/${NAME}"
BRANCH="autoevo/worktree-${NAME}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Idempotency check: already in `git worktree list`?
if git worktree list --porcelain | grep -q "^worktree $(pwd)/${WT_DIR}\$"; then
  echo "{\"event\":\"noop\",\"reason\":\"worktree_exists\",\"name\":\"${NAME}\",\"path\":\"${WT_DIR}\",\"branch\":\"${BRANCH}\"}"
  exit 0
fi

# Also check if the path exists outside git tracking (could be a stale dir)
if [ -d "$WT_DIR" ]; then
  echo "{\"event\":\"error\",\"reason\":\"path_exists_but_not_worktree\",\"path\":\"${WT_DIR}\"}" >&2
  exit 65
fi

# Check the branch isn't checked out elsewhere
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  # Branch already exists — add the worktree on the existing branch
  git worktree add "${WT_DIR}" "${BRANCH}" >&2
else
  git worktree add "${WT_DIR}" -b "${BRANCH}" >&2
fi

# Confirm
if git worktree list --porcelain | grep -q "^worktree $(pwd)/${WT_DIR}\$"; then
  echo "{\"event\":\"created\",\"name\":\"${NAME}\",\"path\":\"${WT_DIR}\",\"branch\":\"${BRANCH}\"}"
  exit 0
else
  echo "{\"event\":\"error\",\"reason\":\"unknown_post_add_failure\",\"name\":\"${NAME}\"}" >&2
  exit 66
fi
