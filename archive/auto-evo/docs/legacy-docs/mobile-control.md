# Mobile / remote control

The AutoDev v3 supervisor is fully file-driven. You can control it from a
phone, browser, or a synced folder by appending lines to the inbox.

## Three control paths (any works)

### 1. Claude Code Remote Control (web/phone UI)

If host Claude Code CLI is installed and Remote Control is enabled
(`claude /remote enable`), the supervisor is observable + controllable
from any phone/browser:

- See current task, recent log, hold items.
- Submit `/status`, `/report`, `/pause`, `/resume`.
- Add new tasks from the web UI (they land in `commands/inbox.md`).

Setup: `./scripts/start_remote_control.sh`

If the host `claude` CLI is missing, the script prints install
instructions and exits 2.

### 2. Direct edit of `commands/inbox.md`

Any path that can edit this file works. iCloud Drive, Dropbox, Working
Copy on iOS, an SSH session — all valid. Appended commands are picked up
on the next supervisor cycle.

Supported commands:

```
/status
/report
/pause
/resume
/new-task P0 <title> :: <details>
/new-task P1 <title> :: <details>
/new-task P2 <title> :: <details>
/set-mode cheap | balanced | premium
/allow-live true | false
/allow-autostart true | false
```

Each command line is hashed; once processed, the line is moved to
`commands/processed.md` and never re-applied (idempotent).

### 3. tmux session (terminal mosh / iTerm / Termius)

```
./scripts/start_tmux_autodev.sh
# attach from anywhere:  tmux attach -t autodev
```

If tmux isn't installed, the script falls back to printing the equivalent
`nohup` invocation.

## launchd (macOS) — auto-start on login

```
./scripts/install_launchd_autodev.sh --install      # install + load
launchctl kickstart -k gui/$(id -u) com.autodev.supervisor    # trigger now
./scripts/install_launchd_autodev.sh --uninstall    # remove
```

The plist sets `AUTODEV_LIVE=0` by default — the agent runs in dry-run
until you edit `~/Library/LaunchAgents/com.autodev.supervisor.plist` to
flip it.

## What "blocked" looks like from your phone

If the supervisor hits a critical blocker (only the kinds listed in
prompt §5), it writes a `HOLD-<n>` entry to `reports/human-hold.md`,
posts to Slack (if `SLACK_WEBHOOK_URL` is set), and exits 0. You'll see
the title on the next `/status` and can decide whether to resolve or
ignore.

For non-critical blockers, the supervisor holds the specific task and
picks the next one on the next cycle, so your phone won't see an
explicit alert — just check `/status` periodically.
