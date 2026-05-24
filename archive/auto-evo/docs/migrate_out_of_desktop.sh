#!/usr/bin/env bash
# migrate_out_of_desktop.sh — one-shot migration of claude-code-247 out of
# ~/Desktop/ (which is TCC-protected) to ~/projects/ (which is not).
#
# Run this from /tmp (NOT from inside the project, since we're about to mv it):
#   cp "/Users/lanston/projects/claude-code-247/migrate_out_of_desktop.sh" /tmp/m.sh
#   bash /tmp/m.sh
#
# Idempotent. Will not destroy data. Asks for confirmation before destructive steps.

set -uo pipefail   # NOT -e: we handle errors explicitly so we can give better messages

# ─────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────
OLD_PATH="/Users/lanston/projects/claude-code-247"
NEW_PARENT="$HOME/projects"
NEW_PATH="$NEW_PARENT/claude-code-247"
PLIST_NAME="com.lanston.autodev.continuous.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"

# Colors (ignored on pipes)
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

bold "═══════════════════════════════════════════════════════════════════"
bold "  AutoDev L7 — Migrate out of ~/Desktop/ (TCC fix)"
bold "═══════════════════════════════════════════════════════════════════"
echo
echo "FROM: $OLD_PATH"
echo "TO:   $NEW_PATH"
echo

# ─────────────────────────────────────────────────
# Step 0 — pre-checks
# ─────────────────────────────────────────────────
echo "──── Step 0: pre-checks ────"

if [[ ! -d "$OLD_PATH" ]]; then
  red "ERROR: $OLD_PATH does not exist. Already moved?"
  if [[ -d "$NEW_PATH" ]]; then
    yellow "  But $NEW_PATH does exist. Migration may already be complete."
    yellow "  Verify with: ls -lt $NEW_PATH/reports/runs/ | head"
  fi
  exit 1
fi

if [[ -d "$NEW_PATH" ]]; then
  red "ERROR: $NEW_PATH already exists. Refusing to overwrite."
  echo "  Decide what to do with the existing target dir, then re-run."
  exit 1
fi

# Verify we're NOT running from inside the project
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$SCRIPT_DIR" in
  "$OLD_PATH"*)
    red "ERROR: this script is currently INSIDE the project being moved."
    red "       The mv would destroy the running script."
    echo
    echo "  Fix: copy the script to /tmp first, then run it from there:"
    echo
    echo "    cp \"$OLD_PATH/migrate_out_of_desktop.sh\" /tmp/m.sh"
    echo "    bash /tmp/m.sh"
    echo
    exit 1
    ;;
esac

green "✓ pre-checks pass"
echo

# ─────────────────────────────────────────────────
# Step 1 — show what's about to happen
# ─────────────────────────────────────────────────
echo "──── Step 1: plan ────"
echo "  1. launchctl unload $PLIST_PATH"
echo "  2. mkdir -p $NEW_PARENT"
echo "  3. mv \"$OLD_PATH\" \"$NEW_PATH\""
echo "  4. sed-replace old path → new path in scripts/, orchestrator/, tests/, *.md, *.yaml"
echo "  5. rm $PLIST_PATH"
echo "  6. bash $NEW_PATH/scripts/install_launchd_continuous.sh --install"
echo "  7. verify"
echo
read -r -p "Proceed? [y/N] " confirm
case "$confirm" in
  y|Y|yes|YES) ;;
  *) yellow "Aborted by user."; exit 0 ;;
esac
echo

# ─────────────────────────────────────────────────
# Step 2 — unload launchd
# ─────────────────────────────────────────────────
echo "──── Step 2: unload launchd ────"
if [[ -f "$PLIST_PATH" ]]; then
  launchctl unload -w "$PLIST_PATH" 2>&1 | sed 's/^/    /'
  green "✓ unloaded $PLIST_NAME"
else
  yellow "  (no plist at $PLIST_PATH — skipping unload)"
fi
echo

# ─────────────────────────────────────────────────
# Step 3 — sanity: no active processes in OLD_PATH
# ─────────────────────────────────────────────────
echo "──── Step 3: check for active processes in old path ────"
busy=$(lsof +D "$OLD_PATH" 2>/dev/null | grep -v "^COMMAND" | wc -l | tr -d ' ')
if [[ "$busy" -gt 0 ]]; then
  yellow "  $busy processes have files open in $OLD_PATH:"
  lsof +D "$OLD_PATH" 2>/dev/null | head -10 | sed 's/^/    /'
  echo
  read -r -p "  Continue anyway? (yes if no critical app — IDE/Terminal cwd is OK) [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) red "Aborted."; exit 1 ;; esac
else
  green "✓ no busy processes"
fi
echo

# ─────────────────────────────────────────────────
# Step 4 — create parent + move
# ─────────────────────────────────────────────────
echo "──── Step 4: move project ────"
mkdir -p "$NEW_PARENT"
mv "$OLD_PATH" "$NEW_PATH"
if [[ -d "$NEW_PATH" && ! -d "$OLD_PATH" ]]; then
  green "✓ moved successfully"
else
  red "ERROR: mv didn't complete as expected"
  red "  OLD still exists: $([[ -d "$OLD_PATH" ]] && echo YES || echo no)"
  red "  NEW exists:       $([[ -d "$NEW_PATH" ]] && echo YES || echo no)"
  exit 1
fi
echo

# ─────────────────────────────────────────────────
# Step 5 — update hardcoded paths
# ─────────────────────────────────────────────────
echo "──── Step 5: update hardcoded paths in runtime files ────"

# Use perl for safe path-in-text replacement (sed gets confused by special chars in paths)
files_with_oldpath=$(
  grep -rl --include="*.sh" --include="*.py" --include="*.md" --include="*.yaml" --include="*.yml" --include="*.json" --include="*.toml" --include="*.txt" \
    --exclude-dir=".git" --exclude-dir=".venv" --exclude-dir="cycles" --exclude-dir="workspaces" --exclude-dir="__pycache__" \
    -F -- "$OLD_PATH" "$NEW_PATH" 2>/dev/null || true
)

if [[ -n "$files_with_oldpath" ]]; then
  count=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    # Use perl for literal string replace, no regex interpretation
    perl -i -pe "s|\Q${OLD_PATH}\E|${NEW_PATH}|g" "$f"
    count=$((count+1))
  done <<< "$files_with_oldpath"
  green "✓ updated path references in $count files"
else
  green "✓ no hardcoded paths needed updating"
fi

# Show what still references the OLD path (informational — historical cycles/ADRs are fine)
remaining=$(
  grep -rl --include="*.sh" --include="*.py" --include="*.md" --include="*.yaml" --include="*.yml" --include="*.json" \
    --exclude-dir=".git" --exclude-dir=".venv" \
    -F -- "$OLD_PATH" "$NEW_PATH" 2>/dev/null || true
)
if [[ -n "$remaining" ]]; then
  yellow "  Historical references still found in these files (mostly in cycles/ — informational only, not runtime):"
  echo "$remaining" | head -10 | sed 's/^/    /'
  total_rem=$(echo "$remaining" | wc -l | tr -d ' ')
  if (( total_rem > 10 )); then
    yellow "    ... and $((total_rem - 10)) more"
  fi
fi
echo

# ─────────────────────────────────────────────────
# Step 6 — remove old plist
# ─────────────────────────────────────────────────
echo "──── Step 6: remove old plist (will be regenerated by install script) ────"
rm -f "$PLIST_PATH"
green "✓ removed $PLIST_PATH"
echo

# ─────────────────────────────────────────────────
# Step 7 — reinstall launchd with new path
# ─────────────────────────────────────────────────
echo "──── Step 7: reinstall launchd from new path ────"
INSTALL_SCRIPT="$NEW_PATH/scripts/install_launchd_continuous.sh"
if [[ ! -f "$INSTALL_SCRIPT" ]]; then
  red "ERROR: $INSTALL_SCRIPT not found after move."
  red "       Cannot reinstall launchd. Project is at $NEW_PATH but agent is not loaded."
  exit 1
fi

cd "$NEW_PATH" && bash "$INSTALL_SCRIPT" --install 2>&1 | sed 's/^/    /'
echo

# ─────────────────────────────────────────────────
# Step 8 — verify
# ─────────────────────────────────────────────────
echo "──── Step 8: verify ────"

# launchctl list
echo "launchctl list:"
launchctl list | grep autodev 2>&1 | sed 's/^/  /' || yellow "  (not yet visible — wait ~10s and re-check)"

# Plist content
if [[ -f "$PLIST_PATH" ]]; then
  echo
  echo "Plist working directory:"
  grep -A1 'WorkingDirectory' "$PLIST_PATH" | head -2 | sed 's/^/  /'
  echo
  echo "Plist program args:"
  grep -A2 'ProgramArguments' "$PLIST_PATH" | head -4 | sed 's/^/  /'
fi

# Quick file-presence sanity
echo
echo "Project location check:"
for f in CHANGELOG.md LEVEL.md HUMAN_CONFIG.md scripts/autodev_continuous_cycle.sh; do
  if [[ -f "$NEW_PATH/$f" ]]; then
    echo "  ✓ $f"
  else
    yellow "  ✗ $f — MISSING (investigate)"
  fi
done
echo

# ─────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────
bold "═══════════════════════════════════════════════════════════════════"
green "  Migration complete."
bold "═══════════════════════════════════════════════════════════════════"
echo
echo "Project is now at:"
echo "  $NEW_PATH"
echo
echo "Next steps:"
echo "  1. Wait ~15 min for the first launchd-driven cycle to run."
echo "  2. Verify with:"
echo "       ls -lt $NEW_PATH/reports/runs/ | head -5"
echo "       bash $NEW_PATH/scripts/autodev_status_dashboard.sh"
echo "  3. If reports/runs/launchd.err.log shows new errors, paste them back to Claude."
echo
echo "Bookmarks (you may want to update):"
echo "  • Any shell aliases that pointed at the old path"
echo "  • Any editor 'recent folders' entries"
echo "  • If you ever 'cd' to the project, the path is now $NEW_PATH"
echo
