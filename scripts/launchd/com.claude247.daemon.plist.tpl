<?xml version="1.0" encoding="UTF-8"?>
<!-- Stage F3: single daemon plist. Replaces v1's four-plist setup
     (dashboard, orchestrator, dispatcher, backup) per workbook §3 F3.
     The TS daemon at packages/daemon serves the dashboard at port 7247
     and runs the dispatcher + scheduler inside one process. Backups
     are now scripted via @aedev/supervisor's adapter, not via a
     separate launchd job. -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude247.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>@@NODE@@</string>
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
    <key>AEDEV_HOME</key><string>@@AEDEV_HOME@@</string>
    <key>AEDEV_DAEMON_PORT</key><string>7247</string>
  </dict>
</dict>
</plist>
