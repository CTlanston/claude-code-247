#!/usr/bin/env bash
# Emergency diagnostic — verify PAUSED stuck, gh availability, container health.
# Run from anywhere; uses absolute paths for tools.
set -u

# Make sure brew-installed CLIs are reachable regardless of which shell rc loaded.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

repo_dir="/Users/lanston/projects/claude-code-247"
cd "$repo_dir" || { echo "cannot cd into $repo_dir"; exit 1; }

hr() { printf '\n── %s ──\n' "$1"; }

hr "1) tool availability"
echo "gh:     $(command -v gh || echo NOT FOUND)"
echo "docker: $(command -v docker || echo NOT FOUND)"

hr "2) PAUSED on host filesystem"
if [[ -f state/PAUSED ]]; then
  ls -la state/PAUSED
  echo "→ PAUSED present on host"
else
  echo "→ PAUSED MISSING on host"
fi

hr "3) container alive?"
docker ps --filter "name=claude-code-247-orchestrator" --format "{{.Names}}  {{.Status}}"

hr "4) recent orchestrator log (last 2 minutes)"
docker logs --since 2m claude-code-247-orchestrator-1 2>&1 | tail -20

hr "5) does the container see /state/PAUSED?"
if docker exec claude-code-247-orchestrator-1 test -f /state/PAUSED 2>/dev/null; then
  docker exec claude-code-247-orchestrator-1 ls -la /state/PAUSED
  echo "→ container CAN see PAUSED"
else
  echo "→ container CANNOT see /state/PAUSED — bind mount sync issue"
fi

hr "6) open PRs with agent:auto label"
if command -v gh >/dev/null 2>&1; then
  gh pr list --repo CTlanston/auto-evo-playground --state open --label agent:auto
else
  echo "gh not on PATH — try: export PATH=/opt/homebrew/bin:\$PATH"
fi

hr "done"
