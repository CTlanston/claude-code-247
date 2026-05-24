<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude247.dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>@UVICORN_BIN@</string>
    <string>dashboard.app:app</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8423</string>
  </array>
  <key>WorkingDirectory</key>
  <string>@REPO_ROOT@</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>@HOME@</string>
    <key>PATH</key>
    <string>@PATH@</string>
    <key>PYTHONPATH</key>
    <string>@REPO_ROOT@</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>@HOME@/.claude-code-247/logs/dashboard.out.log</string>
  <key>StandardErrorPath</key>
  <string>@HOME@/.claude-code-247/logs/dashboard.err.log</string>
</dict>
</plist>
