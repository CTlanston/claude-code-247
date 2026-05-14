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
#                                EnvironmentVariables. If unset, the script
#                                auto-discovers a sensible PATH (see below).
#   AUTODEV_CLAUDE_BIN_DIR       Directory containing the `claude` binary.
#                                If unset, discovered via `command -v claude`
#                                with `mdfind` fallback. Prepended to the
#                                plist PATH so launchd-spawned children can
#                                find claude even when not Terminal-spawned
#                                (Cycle β fix — see ADR-0010).
#   AUTODEV_HOME                 HOME embedded in the plist's
#                                EnvironmentVariables. Defaults to $HOME at
#                                install time. Required because launchd
#                                children do NOT inherit HOME from the
#                                user session.
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
DRY_RUN="${AUTODEV_LAUNCHD_DRY_RUN:-}"

# HOME for launchd-spawned children (NOT inherited from user session).
# Embedded as an absolute path — never a literal `$HOME` in the plist.
AUTODEV_HOME_VALUE="${AUTODEV_HOME:-$HOME}"

# Discover the directory containing `claude` so launchd-spawned children
# can find it. Order:
#   1. AUTODEV_CLAUDE_BIN_DIR explicit override (tests)
#   2. `command -v claude` in the current PATH (operator's shell)
#   3. `mdfind -name claude` matching a node_modules/.bin path
#   4. (give up; emit warning; the plist still installs but claude
#       binary discovery falls back to the operator's default PATH)
_discover_claude_dir() {
  if [[ -n "${AUTODEV_CLAUDE_BIN_DIR:-}" ]]; then
    echo "$AUTODEV_CLAUDE_BIN_DIR"
    return 0
  fi
  if claude_path=$(command -v claude 2>/dev/null) && [[ -n "$claude_path" ]]; then
    # Resolve symlinks (pnpm/.bin points to a versioned dir we want).
    if real=$(readlink -f "$claude_path" 2>/dev/null) && [[ -n "$real" ]]; then
      claude_path="$real"
    fi
    dirname "$claude_path"
    return 0
  fi
  if command -v mdfind >/dev/null 2>&1; then
    mdfind_hit=$(mdfind -name claude 2>/dev/null \
                  | grep -E 'node_modules/\.bin/claude$' \
                  | head -1)
    if [[ -n "$mdfind_hit" ]]; then
      dirname "$mdfind_hit"
      return 0
    fi
  fi
  return 1
}

CLAUDE_DIR="$(_discover_claude_dir || true)"

# If discovered claude path is inside the npx ephemeral cache, warn —
# that directory hash changes when npx re-downloads the package.
if [[ -n "$CLAUDE_DIR" && "$CLAUDE_DIR" == *".npm/_npx/"* ]]; then
  echo "WARNING: discovered claude at ephemeral npx cache: $CLAUDE_DIR" >&2
  echo "         For stable launchd operation, prefer:" >&2
  echo "           npm install -g @anthropic-ai/claude-code" >&2
  echo "         The plist will reference this path, but it can break" >&2
  echo "         if npx re-downloads claude under a new cache hash." >&2
fi

# Compose the plist PATH. CLAUDE_DIR goes first so it wins; the rest
# is the standard macOS PATH plus a pnpm fallback.
_default_launchd_path() {
  local parts=()
  [[ -n "$CLAUDE_DIR" ]] && parts+=("$CLAUDE_DIR")
  parts+=("/usr/local/bin" "/opt/homebrew/bin" "/usr/bin" "/bin")
  parts+=("${AUTODEV_HOME_VALUE}/Library/pnpm/nodejs/20.20.2/bin")
  local IFS=":"
  echo "${parts[*]}"
}

LAUNCHD_PATH="${AUTODEV_LAUNCHD_PATH:-$(_default_launchd_path)}"

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
    <key>HOME</key>
    <string>${AUTODEV_HOME_VALUE}</string>
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

# Operator-facing simulation: show the target plist path, the
# launchctl commands `--install` would invoke, and the plist XML
# body — all to stdout, no side effects (no file write, no
# launchctl, no warning suppressed). Distinct from --print-plist
# (which emits pure XML for downstream tooling).
_cmd_dry_run() {
  echo "=== AutoDev L7 launchd install — DRY RUN @ $(date -u) ==="
  echo
  echo "Target plist path:"
  echo "  $PLIST"
  echo
  echo "launchctl commands --install would invoke (skipped in dry-run):"
  echo "  launchctl unload \"$PLIST\"  # idempotent; ignore failure"
  echo "  launchctl load -w \"$PLIST\""
  echo
  if [[ -n "$CLAUDE_DIR" ]]; then
    echo "Discovered claude bin dir:"
    echo "  $CLAUDE_DIR"
    echo
  else
    echo "WARNING: no claude bin dir discovered — plist PATH will not"
    echo "include one. The installed launchd agent will rely on the"
    echo "operator's default PATH to find \`claude\`."
    echo
  fi
  echo "--- plist content (would be written to the path above) ---"
  _emit_plist
  echo "--- end plist content ---"
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
  --dry-run)
    _cmd_dry_run
    ;;
  -h|--help)
    cat <<EOF
Usage: $0 --install | --uninstall | --status | --print-plist | --dry-run

  --install      Generate plist and load into launchd.
  --uninstall    Unload from launchd and remove the plist file.
  --status       Show plist path, launchctl registration, stop conditions,
                 and current Overall L.
  --print-plist  Emit plist XML to stdout (no side effects, no launchctl).
  --dry-run      Operator-facing simulation: show target path, the launchctl
                 commands --install would run, and the plist XML body. No
                 file writes, no launchctl. Use this BEFORE --install.

Env overrides (advanced):
  AUTODEV_REPO_ROOT, AUTODEV_PLIST_PATH, AUTODEV_INTERVAL_SECONDS,
  AUTODEV_TARGET_L, AUTODEV_LAUNCHD_PATH, AUTODEV_CLAUDE_BIN_DIR,
  AUTODEV_HOME, AUTODEV_LAUNCHD_DRY_RUN
EOF
    exit 0
    ;;
  "")
    echo "Usage: $0 --install | --uninstall | --status | --print-plist | --dry-run" >&2
    exit 1
    ;;
  *)
    echo "Unknown flag: $1" >&2
    echo "Usage: $0 --install | --uninstall | --status | --print-plist | --dry-run" >&2
    exit 1
    ;;
esac
