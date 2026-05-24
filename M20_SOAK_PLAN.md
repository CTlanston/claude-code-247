# M20 24h Soak Plan

**Started**: 2026-05-24 (UTC)
**Subject**: `claude-code-247` running on local Mac under launchd, 4 services loaded.

## What we're proving

The system can sit idle for 24 hours under `launchd` without:

- Crashing or stalling any of the 4 services.
- Filling the dashboard error log with stack traces.
- Producing orphan `running`-state commands left over by a crashed dispatcher tick.
- Triggering repeated identical alerts ("alert storm").
- Burning Anthropic API spend while idle.
- Mutating any GitHub repo without an explicit operator command.

The system is **idle by design** during the soak — there should be no queued commands and no active tasks. The dispatcher should fire every 30s, see an empty queue, and do nothing.

## First checkpoint baseline (t = 0)

Captured immediately after `scripts/install_launchd.sh` succeeded.

| Service | State | PID | Last exit |
|---|---|---|---|
| `com.claude247.dashboard` | loaded, KeepAlive | running | 0 |
| `com.claude247.orchestrator` | loaded, 60s tick | scheduled | 0 |
| `com.claude247.dispatcher` | loaded, 30s tick | scheduled | 0 |
| `com.claude247.backup` | loaded, daily 03:17 | scheduled | 0 |

Dashboard healthz: `GET http://127.0.0.1:8423/healthz` → `{"ok": true}`.

Dashboard stderr log (198 bytes): uvicorn startup info only — `Started server process [42273]`, `Application startup complete.`, `Uvicorn running on http://127.0.0.1:8423`. **No errors.**

## Health-check commands (re-run any time)

```bash
# 1. Are all 4 services still loaded? Any non-zero last exit?
for svc in com.claude247.dashboard com.claude247.orchestrator com.claude247.dispatcher com.claude247.backup; do
  if launchctl list "$svc" >/dev/null 2>&1; then
    pid=$(launchctl list 2>/dev/null | awk -v n="$svc" '$3==n{print $1}')
    code=$(launchctl list 2>/dev/null | awk -v n="$svc" '$3==n{print $2}')
    echo "$svc: loaded pid=$pid last_exit=$code"
  else
    echo "$svc: NOT loaded"
  fi
done

# 2. Is the dashboard still live?
curl -fsS -m 5 http://127.0.0.1:8423/healthz

# 3. Is the system idle?
claude247 status --plain

# 4. Any orphan running commands? (should be 0)
.venv/bin/python -c "
from memory.db import open_db
with open_db() as conn:
    n = conn.execute(\"SELECT COUNT(*) FROM commands WHERE status = 'running'\").fetchone()[0]
    print(f'commands.status=running: {n}')
    n = conn.execute(\"SELECT COUNT(*) FROM tasks WHERE status IN ('queued','planning','coding','testing','reviewing','validating')\").fetchone()[0]
    print(f'active tasks: {n}')
"

# 5. Any new alerts since last check?
.venv/bin/python -m gateway.cli logs tail --limit 30 --plain

# 6. Backup script — should have rotated overnight (after 03:17 UTC)
ls -la ~/.claude-code-247/state/backups/ | head -20

# 7. Dashboard error log size — should grow only slowly (rotation warnings, etc.)
ls -la ~/.claude-code-247/logs/

# 8. Anthropic API spend — must remain $0 while system is idle. Operator
#    confirms via console.anthropic.com or by inspecting any
#    `cost_estimate` rows in the runs table.
.venv/bin/python -c "
from memory.db import open_db
with open_db() as conn:
    total = conn.execute(\"SELECT COALESCE(SUM(cost_estimate),0) FROM runs WHERE auth_mode='anthropic_api' AND created_at > datetime('now','-1 day')\").fetchone()[0]
    print(f'last-24h anthropic spend (worker-attributed): {total}')
"
```

## What counts as a SOAK FAILURE

| Symptom | Meaning |
|---|---|
| Any service shows `NOT loaded` | launchd dropped it; restart with `scripts/install_launchd.sh` |
| `last_exit != 0` repeatedly | something is crashing on every tick. Inspect the `.err.log`. |
| `/healthz` unreachable | dashboard died and KeepAlive isn't bringing it back |
| `commands.status='running'` for > 5 min | dispatcher crashed mid-tick; gc should recover but verify |
| `active tasks > 0` while idle | someone queued work during the soak — not a failure per se, but invalidates the "idle" measurement |
| `anthropic` cost > $0 while idle | something is invoking the API outside of explicit worker runs |
| Same alert message > 5 times | dedup is broken or the underlying issue is real |
| Dashboard err log > 1 MB | log rotation or a recurring exception |

## Stop / uninstall commands

```bash
# Stop all in-flight work without uninstalling the daemons
claude247 stop-all

# Pause the whole system (dispatcher will see queue but skip claims)
claude247 pause --system

# Uninstall the launchd daemons entirely
scripts/uninstall_launchd.sh
```

## Checkpoint schedule

| When | Action |
|---|---|
| t = 0 (now) | Baseline (above). 4 services loaded; dashboard live. |
| t + 1 h | Run health-check block 1–7. Confirm dispatcher fired ≥ 120 times with last_exit=0. |
| t + 6 h | Same. Plus inspect dispatcher.out.log for any unexpected work. |
| t + 24 h | Same. Plus confirm backup ran (check `~/.claude-code-247/state/backups/` for a new file dated after 03:17 UTC). |

Each checkpoint result feeds back into `M20_PRODUCTION_PROOF_REPORT.md` under a `## Soak observations` section.

## Why the soak is meaningful for production claim

A v1.0 release of a 24/7 daemon needs evidence that "leaving it on" is safe. The unit tests prove single-call correctness. The E2E proves end-to-end correctness on a real PR. The soak proves the system stays healthy when it has *nothing* to do — the failure mode that catches most "agentic" tools is silent crash-loop on idle.

Anthropic API spend = **$0** while idle is the financial proof: the system never wakes up to "check in" or "ping home"; if the queue is empty, the cost is zero.
