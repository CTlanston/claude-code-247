#!/usr/bin/env bash
# install_launchd_continuous.sh — install/uninstall the AutoDev L7
# continuous-cycle launchd agent.
#
# This is the L7 layer's launchd installer, distinct from the v3
# `install_launchd_autodev.sh` (which installs the v3 supervisor agent
# `com.autodev.supervisor`). This one installs
# `com.lanston.autodev.continuous`, running `autodev_continuous_cycle.sh`
# every AUTODEV_INTERVAL_SECONDS (default 900s = 15 min).
#
# Usage:
#   bash scripts/install_launchd_continuous.sh --install       # install + load
#   bash scripts/install_launchd_continuous.sh --uninstall     # unload + remove
#   bash scripts/install_launchd_continuous.sh --status        # show status
#   bash scripts/install_launchd_continuous.sh --print-plist   # emit plist to stdout
#
# Env knobs (override defaults for tests/operations):
#   AUTODEV_REPO_ROOT            repo path; default: this script's parent of parent
#   AUTODEV_PLIST_PATH           plist file location;
#                                default: $HOME/Library/LaunchAgents/<LABEL>.plist
#   AUTODEV_INTERVAL_SECONDS     StartInterval; default 900 (15 min)
#   AUTODEV_TARGET_L             Overall L termination target; default 5
#   AUTODEV_LAUNCHD_PATH         PATH passed into the plist's
#                                EnvironmentVariables; sensible Homebrew default
#   AUTODEV_LAUNCHD_DRY_RUN      if non-empty, skip all `launchctl` calls
#                                (used by tests; never by operators)
#
# CRITICAL: This script does NOT auto-install on import. It MUST be invoked
# with --install by the operator exactly ONCE, after Phase B is complete.
# Tests use --print-plist or AUTODEV_LAUNCHD_DRY_RUN=1 with --install to
# avoid touching the real launchd.

set -u

# --- Configuration -----------------------------------------------------

LABEL="com.lanston.autodev.continuous"

# AUTODEV_REPO_ROOT — let the operator override; otherwise derive from the
# script's location (so this works when symlinked, called from anywhere, etc.)
if [[ -z "${AUTODEV_REPO_ROOT:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  AUTODEV_REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
REPO="${AUTODEV_REPO_ROOT}"

PLIST="${AUTODEV_PLIST_PATH:-$HOME/Library/LaunchAgents/${LABEL}.plist}"
INTERVAL="${AUTODEV_INTERVAL_SECONDS:-900}"
TARGET_L="${AUTODEV_TARGET_L:-5}"
LAUNCHD_PATH="${AUTODEV_LAUNCHD_PATH:-/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$HOME/Library/pnpm/nodejs/20.20.2/bin}"
DRY_RUN="${AUTODEV_LAUNCHD_DRY_RUN:-}"

# --- Helpers -----------------------------------------------------------

# Run launchctl unless we're in dry-run mode. Always returns 0 in dry-run
# so the calling flow can proceed in tests.
_launchctl() {
  if [[ -n "$DRY_RUN" ]]; then
    return 0
  fi
  launchctl "$@"
}

# Generate the plist XML to stdout. Pure function: same inputs → same output.
_emit_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO}/scripts/autodev_continuous_cycle.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AUTODEV_TARGET_L</key>
    <string>${TARGET_L}</string>
    <key>PATH</key>
    <string>${LAUNCHD_PATH}</string>
  </dict>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>StandardOutPath</key>
  <string>${REPO}/reports/runs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${REPO}/reports/runs/launchd.err.log</string>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
EOF
}

# --- Subcommands -------------------------------------------------------

_cmd_install() {
  mkdir -p "$(dirname "$PLIST")"
  _emit_plist > "$PLIST"
  echo "Wrote plist: $PLIST"

  # Idempotent load: unload first (ignore failure if not loaded) then
  # load with -w (persistent enable).
  _launchctl unload "$PLIST" 2>/dev/null || true
  _launchctl load -w "$PLIST"

  if [[ -z "$DRY_RUN" ]]; then
    echo "Loaded into launchd. Status:"
    launchctl list 2>/dev/null | grep "$LABEL" \
      || echo "  (not yet visible — wait ~10s, then run --status)"
  else
    echo "[dry-run] skipped launchctl load -w $PLIST"
  fi
}

_cmd_uninstall() {
  _launchctl unload -w "$PLIST" 2>/dev/null || true
  if [[ -f "$PLIST" ]]; then
    rm -f "$PLIST"
    echo "Removed plist: $PLIST"
  else
    echo "No plist at $PLIST — nothing to uninstall."
  fi
}

_cmd_status() {
  echo "=== AutoDev L7 launchd status @ $(date -u) ==="
  echo
  echo "Label:     $LABEL"
  echo "Plist:     $PLIST"
  echo "Repo:      $REPO"
  echo "Interval:  ${INTERVAL}s"
  echo "Target L:  $TARGET_L"
  echo

  echo "-- plist file --"
  if [[ -f "$PLIST" ]]; then
    echo "  exists ($(wc -c < "$PLIST" | tr -d ' ') bytes)"
  else
    echo "  not installed"
  fi
  echo

  echo "-- launchd registration --"
  if [[ -n "$DRY_RUN" ]]; then
    echo "  [dry-run] skipped"
  else
    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
      launchctl list | grep "$LABEL"
    else
      echo "  not loaded"
    fi
  fi
  echo

  echo "-- stop conditions --"
  [[ -f "$REPO/reports/AUTODEV_DONE.md" ]] \
    && echo "  - reports/AUTODEV_DONE.md present (mission complete)"
  [[ -f "$REPO/reports/STOPSWITCH" ]] \
    && echo "  - reports/STOPSWITCH present (human halt)"
  [[ -f "$REPO/BLOCKED.md" ]] && echo "  - BLOCKED.md present"
  [[ -f "$REPO/reports/quota-rate-limit-until.ts" ]] \
    && echo "  - reports/quota-rate-limit-until.ts present"
  echo

  echo "-- overall level --"
  if [[ -f "$REPO/LEVEL.md" ]]; then
    grep '^Overall L' "$REPO/LEVEL.md" 2>/dev/null \
      || echo "  (LEVEL.md exists, no Overall L line)"
  else
    echo "  (LEVEL.md missing)"
  fi
}

_cmd_print_plist() {
  _emit_plist
}

# --- Dispatch ----------------------------------------------------------

case "${1:-}" in
  --install)
    _cmd_install
    ;;
  --uninstall)
    _cmd_uninstall
    ;;
  --status)
    _cmd_status
    ;;
  --print-plist)
    _cmd_print_plist
    ;;
  -h|--help)
    cat <<EOF
Usage: $0 --install | --uninstall | --status | --print-plist

  --install      Generate plist and load into launchd.
  --uninstall    Unload from launchd and remove the plist file.
  --status       Show plist path, launchctl registration, stop conditions,
                 and current Overall L.
  --print-plist  Emit plist XML to stdout (no side effects, no launchctl).

Env overrides (advanced):
  AUTODEV_REPO_ROOT, AUTODEV_PLIST_PATH, AUTODEV_INTERVAL_SECONDS,
  AUTODEV_TARGET_L, AUTODEV_LAUNCHD_PATH, AUTODEV_LAUNCHD_DRY_RUN
EOF
    exit 0
    ;;
  "")
    echo "Usage: $0 --install | --uninstall | --status | --print-plist" >&2
    exit 1
    ;;
  *)
    echo "Unknown flag: $1" >&2
    echo "Usage: $0 --install | --uninstall | --status | --print-plist" >&2
    exit 1
    ;;
esac
