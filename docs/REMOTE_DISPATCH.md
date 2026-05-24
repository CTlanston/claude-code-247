# Remote / Dispatch — operating from your phone

`claude-code-247` is designed to be driven from a mobile Claude Remote
or Dispatch session. The local Mac is the worker; your phone is the
control surface. This doc covers the day-to-day moves.

## Prerequisites

- The local orchestrator is installed and started under `launchd`
  (`make install` or `scripts/install_launchd.sh`).
- ntfy.sh topic configured in `~/.claude-code-247/config.yaml`:
  ```yaml
  notifications:
    ntfy:
      topic: claude247-<your-secret-slug>
      server: https://ntfy.sh
  ```
- ntfy app installed on your phone, subscribed to that topic.

Validate with:
```bash
claude247 doctor --plain
```

## The mobile-friendly CLI surface

All commands accept `--plain` (human-tight) and `--json` (machine).
The plain mode is built to fit a phone screen.

### Status
```bash
claude247 status --plain
```
Returns the system mode, repo counts, task counts by status,
pending command count, and pending approval count — under ten lines.

### Tasks
```bash
claude247 tasks --plain
claude247 task <task_id>
```
List shows one line per task: `id [status] repo :: goal`.
Detail prints the timeline.

### Logs
```bash
claude247 logs tail --repo my-repo --limit 20
claude247 logs search "validator failed"
```
Uses the structured log store; FTS5 backs the search.

### Pause / resume
```bash
claude247 pause --system
claude247 pause --repo my-repo
claude247 pause --task task_xyz

claude247 resume --system
claude247 resume --repo my-repo
claude247 resume --task task_xyz
```
Every pause/resume enqueues a command to the orchestrator's queue;
nothing happens directly from your CLI. The orchestrator drains the
queue and emits an audit event.

### Explain stuck
```bash
claude247 explain-stuck --task task_xyz
claude247 explain-stuck --task task_xyz --verbose
```
The orchestrator's dispatcher (lands fully in M10) summarises:
what the task was trying to do, the last successful step, the
failure point, the likely root cause, the relevant logs, and
recommended next actions.

### Approve / reject merges
When ntfy pushes you a `approval_required` event for a medium-risk
PR, the message contains the repo and PR number.

```bash
claude247 approve-merge --repo my-repo --pr 42
claude247 reject-merge --repo my-repo --pr 42 --reason "scope creep"
```

### Risk inspection
```bash
claude247 risk --repo my-repo --pr 42 --json
```
Returns the most-recent computed risk score with its factor breakdown.

### Emergency stop
```bash
claude247 stop-all
```

## ntfy notification events

The orchestrator pushes these events through `notification_manager`:

| Event                  | Default priority | Typical action |
|------------------------|------------------|----------------|
| `approval_required`    | 5 (top)          | inspect /prs/{repo}/{pr_number}, approve/reject |
| `task_stuck`           | 4                | `claude247 explain-stuck --task <id>` |
| `task_failed`          | 4                | inspect timeline, optionally `claude247 replay --task <id>` |
| `budget_exceeded`      | 4                | inspect /budgets, raise caps or pause repo |
| `doctor_failed`        | 4                | run `claude247 doctor` locally |
| `system_paused`        | 4                | someone or something invoked stop-all |
| `validation_failed`    | 3                | likely waiting_for_approval; review |
| `pr_created`           | 3                | inspect /prs/{repo}/{pr_number} |
| `task_started`         | 2                | informational |
| `task_completed`       | 2                | informational |
| `auto_merge_completed` | 2                | informational |

Same `(event, repo, task, message)` fingerprint within
`notifications.dedup_window_minutes` (default 30) collapses into one
push — your phone will not flap during oscillating CI.

## Dashboard

If your phone has a browser and you're on the same network as the Mac,
you can also use the dashboard:
```
http://<mac-hostname>:8423/
```
Every approval / rejection / pause button on the dashboard enqueues a
command — same audit trail as the CLI.
