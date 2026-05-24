<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude247.orchestrator</string>
  <key>ProgramArguments</key>
  <array>
    <string>@CLAUDE247_BIN@</string>
    <string>status</string>
    <string>--plain</string>
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
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>@HOME@/.claude-code-247/logs/orchestrator.out.log</string>
  <key>StandardErrorPath</key>
  <string>@HOME@/.claude-code-247/logs/orchestrator.err.log</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
