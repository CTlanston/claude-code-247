<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude247.rollback-drill</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/lanston/Library/pnpm/pnpm</string>
    <string>tsx</string>
    <string>scripts/rollback-drill-random.ts</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/lanston/projects/claude-code-247</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Day</key><integer>1</integer>
    <key>Hour</key><integer>4</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/Users/lanston/.claude-code-247/logs/rollback-drill.out.log</string>
  <key>StandardErrorPath</key><string>/Users/lanston/.claude-code-247/logs/rollback-drill.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>/Users/lanston</string>
    <key>PATH</key><string>/Users/lanston/Library/pnpm:/Users/lanston/Library/pnpm/nodejs/20.20.2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
