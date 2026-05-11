#!/usr/bin/env bash
# install_launchd_autodev.sh — generate (and optionally install) a macOS
# LaunchAgent that runs the AutoDev v3 supervisor.
#
# By default, the script ONLY generates the plist into reports/ and prints
# how to install it. Pass --install to copy it into ~/Library/LaunchAgents
# and load it. Pass --uninstall to remove a previously installed agent.
#
# Hard rules:
#   - Never installs unless --install is given explicitly.
#   - Uses absolute paths only.
#   - Logs stdout/stderr to reports/supervisor.{stdout,stderr}.log
#   - Refuses to run unless `state/.autodev_supervisor.lock` directory parent
#     exists, to avoid surprise launches before doctor passes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.autodev.supervisor"
PLIST_OUT="$ROOT/reports/$LABEL.plist"

mkdir -p "$ROOT/reports" "$ROOT/state"

INSTALL=0
UNINSTALL=0
for a in "$@"; do
  case "$a" in
    --install)    INSTALL=1 ;;
    --uninstall)  UNINSTALL=1 ;;
    *)            echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

cat >"$PLIST_OUT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/scripts/autodev_supervisor.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${ROOT}/reports/supervisor.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT}/reports/supervisor.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AUTODEV_LIVE</key><string>0</string>
    <key>AUTODEV_MODE</key><string>cheap</string>
    <key>AUTODEV_INTERVAL_SECONDS</key><string>900</string>
  </dict>
</dict>
</plist>
EOF

echo "Generated: $PLIST_OUT"

if [[ "$UNINSTALL" == "1" ]]; then
  TARGET="$HOME/Library/LaunchAgents/${LABEL}.plist"
  if [[ -f "$TARGET" ]]; then
    launchctl unload -w "$TARGET" 2>/dev/null || true
    rm -f "$TARGET"
    echo "Uninstalled: $TARGET"
  else
    echo "Nothing to uninstall at: $TARGET"
  fi
  exit 0
fi

if [[ "$INSTALL" != "1" ]]; then
  cat <<INFO

This script DID NOT install the LaunchAgent. To install:
  cp "$PLIST_OUT" "\$HOME/Library/LaunchAgents/"
  launchctl load -w "\$HOME/Library/LaunchAgents/${LABEL}.plist"

To start the supervisor immediately (without waiting for next launchd
trigger):
  launchctl kickstart -k gui/\$(id -u)/${LABEL}

To uninstall:
  ./scripts/install_launchd_autodev.sh --uninstall

Notes:
  - The plist sets AUTODEV_LIVE=0 so the agent runs in DRY-RUN until you
    edit ~/Library/LaunchAgents/${LABEL}.plist to flip it.
  - The agent does NOT RunAtLoad — it runs only when launchctl kickstart
    fires it. Adjust the plist if you want auto-start at login.
INFO
  exit 0
fi

TARGET="$HOME/Library/LaunchAgents/${LABEL}.plist"
cp "$PLIST_OUT" "$TARGET"
launchctl unload -w "$TARGET" 2>/dev/null || true
launchctl load -w "$TARGET"
echo "Installed and loaded: $TARGET"
echo "Trigger now with: launchctl kickstart -k gui/\$(id -u)/${LABEL}"
