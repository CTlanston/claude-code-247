<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>@@LABEL@@</string>
  <key>ProgramArguments</key>
  <array>
    <string>@@PNPM@@</string>
    <string>tsx</string>
    <string>scripts/autoflow-loop.ts</string>
@@MAX_CYCLES_ARGS@@
  </array>
  <key>WorkingDirectory</key><string>@@REPO_ROOT@@</string>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>StartInterval</key><integer>@@START_INTERVAL@@</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>@@LOG_DIR@@/autoflow.out.log</string>
  <key>StandardErrorPath</key><string>@@LOG_DIR@@/autoflow.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>@@HOME@@</string>
    <key>PATH</key><string>@@PATH@@</string>
    <key>AEDEV_AUTOFLOW_REPO_ROOT</key><string>@@TARGET_REPO_ROOT@@</string>
    <key>AEDEV_AUTOFLOW_WORKBOOK</key><string>@@WORKBOOK@@</string>
    <key>AEDEV_AUTOFLOW_HOME</key><string>@@AUTOFLOW_HOME@@</string>
    <key>AEDEV_AUTOFLOW_BRANCH</key><string>@@AUTOFLOW_BRANCH@@</string>
@@EXTRA_ENV@@
  </dict>
</dict>
</plist>
