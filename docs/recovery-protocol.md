# Recovery protocol

Where everything you need to survive a session death lives.

## State file: `reports/state.json`

Read every cycle. Schema in `autodev/project_state.py:SCHEMA_DEFAULTS`. The
key fields the supervisor cares about:

| Field | Meaning |
| --- | --- |
| `paused` | If true, supervisor cycles short-circuit without picking work |
| `live_allowed` | If false, every inner-engine invocation is dry-run |
| `current_task_id` / `current_task_title` | The task being worked on |
| `current_phase` | The supervisor's last meaningful step |
| `blocked` / `blocker_reason` | Set when a task hits a non-critical wall |
| `repair_attempts_for_current_task` | Capped at 3 before holding |
| `cost_mode` | cheap / balanced / premium |
| `health_status` | green / warn / bootstrap / unknown |

## If `state.json` is corrupt

`autodev/project_state.py:ProjectState.load()` detects bad JSON and:

1. Copies the bad file to `reports/state.corrupt.<ts>.json`.
2. Initialises a fresh state with defaults.
3. Continues — the supervisor cycle treats this as `health_status="bootstrap"`
   and lets the recovery manager fall through to `REPAIR_STATE` (a no-op
   green-mark that resumes normal flow on the next cycle).

## RecoveryManager decision tree (in priority order)

```
report_only   if /report command was just queued
pause         if state.paused
hold_for_human if any HOLD-<n> in human-hold.md has severity=critical
repair_state  if health_status in {bootstrap, unknown}
continue_current   if current_task_id is set AND not blocked
select_new    otherwise — pick from backlog.md
```

## What survives a kill -9

Everything that matters. State, task pointer, command inbox, hold report,
session log — all on disk. The supervisor's in-memory state is rebuilt
from these files at the top of every cycle.

What doesn't survive: an in-flight `subprocess.run()` call into
`orchestrator/main_oneshot.py`. If the supervisor is killed mid-inner-tick,
the inner engine may have committed some work and the next cycle picks up
from the resulting state on disk (`state/orchestrator.db` is the inner
engine's own SQLite — separately durable).

## Resumption commands

```bash
# I just rebooted the laptop. Status check:
./scripts/autodev_status.sh

# Resume from paused/blocked manually:
echo "/resume" >> commands/inbox.md
./scripts/autodev_once.sh

# Or just let the long-running supervisor pick it up on the next cycle:
./scripts/autodev_supervisor.sh
```
