<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude247.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>@REPO_ROOT@/scripts/backup_db.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>@HOME@</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>@HOME@</string>
    <key>PATH</key>
    <string>@PATH@</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>17</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>@HOME@/.claude-code-247/logs/backup.out.log</string>
  <key>StandardErrorPath</key>
  <string>@HOME@/.claude-code-247/logs/backup.err.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
