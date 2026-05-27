# Rollback Drill Cadence — Workbook §3.99

The workbook mandates a random-stage rollback drill **every 4 weeks**.
This document captures the procedure and the suggested cron entry.

## What the drill proves

GROUND RULE 4 (schema dual-compat) is preserved as the codebase evolves.
If any new migration sneaks in that drops/renames a v1 column, the drill
will catch it: the round-trip `up → business → down` cycle will leave the
legacy `events` row count different from the baseline.

## Manual run

```sh
pnpm tsx scripts/rollback-drill-random.ts
# Or with a deterministic seed
pnpm tsx scripts/rollback-drill-random.ts 42
```

Writes a report to `evidence/drills/rollback-<UTC>.md`. Exits 0 on PASS,
non-zero on FAIL (with explanation of which invariant broke).

## Scheduled run

### launchd (macOS — recommended)

```xml
<!-- ~/Library/LaunchAgents/com.claude247.rollback-drill.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude247.rollback-drill</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>pnpm</string>
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
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.claude247.rollback-drill.plist
```

### systemd (Linux)

```ini
# ~/.config/systemd/user/rollback-drill.service
[Unit]
Description=claude-code-247 monthly rollback drill

[Service]
Type=oneshot
WorkingDirectory=%h/projects/claude-code-247
ExecStart=/usr/bin/env pnpm tsx scripts/rollback-drill-random.ts

# ~/.config/systemd/user/rollback-drill.timer
[Unit]
Description=run rollback drill 04:00 UTC on day 1 of month

[Timer]
OnCalendar=*-*-01 04:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user enable --now rollback-drill.timer
```

### GitHub Actions (cross-platform)

The CI workflow at `.github/workflows/security.yml` runs a Sunday-04:00-UTC
cron sweep. A similar cron for the rollback drill can be added if remote
CI is preferred over local launchd/systemd.

## What to do on FAIL

A drill FAIL means GROUND RULE 4 was broken at some point. Procedure:

1. Read the `evidence/drills/rollback-<UTC>.md` FAIL EXPLANATION block.
2. `git log -p packages/core/src/migrations.ts` since the last PASS-ing
   drill — find the commit that broke the schema.
3. Open a HOLD per workbook §8 with reason `production_incident` (this
   is GR4 territory, halt-class).
4. Revert or compensate.
5. Re-run the drill to confirm PASS.
6. Resolve the HOLD.

## What this drill does NOT replace

- The operator's real-clock rollback drill against an actual Mac install
  (workbook §3 Stage M L3). That's still a precondition for the v2.1.0
  GA tag per ADR-0012.
