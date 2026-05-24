<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude247.dispatcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>@CLAUDE247_BIN@</string>
    <string>dispatcher</string>
    <string>--once</string>
  </array>
  <key>WorkingDirectory</key>
  <string>@HOME@</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>@HOME@</string>
    <key>PATH</key>
    <string>@PATH@</string>
    <key>CLAUDE247_CONFIG</key>
    <string>@HOME@/.claude-code-247/config.yaml</string>
  </dict>
  <key>StartInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>@HOME@/.claude-code-247/logs/dispatcher.out.log</string>
  <key>StandardErrorPath</key>
  <string>@HOME@/.claude-code-247/logs/dispatcher.err.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
