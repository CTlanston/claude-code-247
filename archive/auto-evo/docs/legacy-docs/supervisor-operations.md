# Supervisor operations runbook

## Daily

```bash
./scripts/autodev_status.sh         # 30-second eyeball check
./scripts/autodev_report.sh         # human-readable daily
tail -40 reports/session-log.md     # raw audit trail
```

## Starting a live cycle

```bash
# 1. Sanity check
./scripts/autodev_doctor.sh

# 2. Dry-run (should always pass)
./scripts/autodev_once.sh --dry-run

# 3. Live single cycle (requires HUMAN_CONFIG.md:runtime.live_allowed=true)
AUTODEV_LIVE=1 ./scripts/autodev_once.sh

# 4. If single cycle behaves, start the long loop
AUTODEV_LIVE=1 ./scripts/autodev_supervisor.sh
# or detached:
./scripts/start_tmux_autodev.sh
```

## Stopping

```bash
# Soft pause — supervisor finishes current cycle, then idles
echo "/pause" >> commands/inbox.md

# Hard pause — the inner engine PAUSED flag, picked up mid-cycle
touch state/PAUSED state/PAUSED.human

# Kill the long-running supervisor
pkill -f "autodev_supervisor.sh"   # or kill the tmux session
```

## Resuming

```bash
rm -f state/PAUSED state/PAUSED.human
echo "/resume" >> commands/inbox.md
./scripts/autodev_once.sh
```

## When something goes wrong

1. `./scripts/autodev_status.sh` — anything `human_needed=true` or
   `blocked=true`?
2. `cat reports/human-hold.md` — what does the HOLD-N entry say?
3. `tail -80 reports/session-log.md` — what happened during the last
   few cycles?
4. `cat reports/decisions.md` — was anything denied by the cost
   controller that should have been allowed?
5. If state.json looks broken: `ls reports/state.corrupt.*.json` —
   the supervisor backs up bad state automatically and you can diff.

## Forcing a specific cost mode

```bash
# Persistent
echo "/set-mode balanced" >> commands/inbox.md
# or edit HUMAN_CONFIG.md

# One-shot (env override)
AUTODEV_MODE=balanced ./scripts/autodev_once.sh    # script logs the intent
```

## Manually injecting a task

Pick one:

```bash
# Via command inbox (preferred — auditable)
echo '/new-task P1 Fix telemetry boundary :: see issue #6' >> commands/inbox.md

# Or by editing the backlog directly
$EDITOR tasks/backlog.md
```

## Slack notifications

`SLACK_WEBHOOK_URL` in `.env` is the single source. Hooks
(`.claude/hooks/notify.sh`) and the inner engine both use it. To stop
notifications, leave the variable empty — every notify call no-ops cleanly.
