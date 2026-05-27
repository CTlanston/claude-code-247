<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude247.roadmap-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/lanston/Library/pnpm/pnpm</string>
    <string>tsx</string>
    <string>scripts/roadmap-agent-tick.ts</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/lanston/projects/claude-code-247</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>/Users/lanston/.claude-code-247/logs/roadmap-agent.out.log</string>
  <key>StandardErrorPath</key><string>/Users/lanston/.claude-code-247/logs/roadmap-agent.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>/Users/lanston</string>
    <key>AEDEV_HOME</key><string>/Users/lanston/.claude-code-247/aedev-daemon</string>
    <key>PATH</key><string>/Users/lanston/Library/pnpm:/Users/lanston/Library/pnpm/nodejs/20.20.2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
