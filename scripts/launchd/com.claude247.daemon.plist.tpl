<?xml version="1.0" encoding="UTF-8"?>
<!-- Single daemon plist (Stage F3 + P1). Rendered by scripts/install_launchd.sh.
     Runs the TS daemon entry packages/daemon/src/main.ts on port 7247, with the
     dispatcher + scheduler inside one process. PATH is pinned so the worker can
     find pnpm/node/git/claude/codex under launchd's minimal environment.
     ProgramArguments execs node DIRECTLY (node --import tsx <entry>) rather than
     `pnpm tsx ...` so launchd tracks the actual :7247 listener PID — otherwise the
     pnpm/tsx wrapper chain orphans the node grandchild, which keeps the port and
     makes kickstart/KeepAlive restarts crash-loop on EADDRINUSE. -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude247.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>@@NODE@@</string>
    <string>--import</string>
    <string>tsx</string>
    <string>@@DAEMON_ENTRY@@</string>
  </array>
  <key>WorkingDirectory</key><string>@@REPO_ROOT@@</string>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>@@LOG_DIR@@/daemon.out.log</string>
  <key>StandardErrorPath</key><string>@@LOG_DIR@@/daemon.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HOME</key><string>@@HOME@@</string>
    <key>PATH</key><string>@@PATH@@</string>
    <key>AEDEV_HOME</key><string>@@AEDEV_HOME@@</string>
    <key>AEDEV_DAEMON_PORT</key><string>7247</string>
    <key>AEDEV_SCHEDULER_INTERVAL_MS</key><string>60000</string>
  </dict>
</dict>
</plist>
