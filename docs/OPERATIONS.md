# Operations

Day-to-day commands and where to look when something is off.

## Start of day

```bash
claude247 status --plain                # one screen summary
claude247 doctor                         # environment OK?
open http://127.0.0.1:8423              # dashboard overview
```

If `doctor` is red on something required, fix that first.

## During the day

| Want to… | Do |
|---|---|
| Queue a task | `claude247 start --repo X --goal "..."` |
| See active tasks | `claude247 tasks --plain` |
| See one task's timeline | `claude247 task <task_id>` |
| Tail logs | `claude247 logs tail --limit 50` |
| Search logs | `claude247 logs search "validator failed"` |
| Approve a PR | `claude247 approve-merge --repo X --pr 42` |
| Reject a PR | `claude247 reject-merge --repo X --pr 42 --reason "..."` |
| Inspect a PR's risk | `claude247 risk --repo X --pr 42` |
| Pause everything | `claude247 pause --system` |
| Pause one repo | `claude247 pause --repo X` |
| Resume | `claude247 resume --system` |
| Emergency stop | `claude247 stop-all` |
| Explain stuck task | `claude247 explain-stuck --task <id>` |
| Replay a failed task | `claude247 replay --task <id> --explain-only` |

## Memory hygiene (weekly)

```bash
claude247 memory compile --weekly        # all repos
claude247 memory init --repo X           # if .agent dir is empty
```

The compiler is safe to re-run — it appends, doesn't overwrite.

## When a task is stuck

1. `claude247 explain-stuck --task <id>` — orchestrator-side summary.
2. `claude247 task <id>` — full timeline.
3. `claude247 logs tail --task <id>` — surrounding logs.
4. `claude247 replay --task <id> --explain-only` — full evidence
   package summary.
5. If you want to retry: `claude247 replay --task <id> --repair`.

## When a PR is waiting for approval

Open `/prs/<repo>/<pr>` on the dashboard for the full risk + validator
breakdown, then approve or reject from the same page. Phone-only flow:
`claude247 risk --repo X --pr 42`, then `approve-merge` /
`reject-merge`.

## When the system is too noisy

The dedup window for ntfy is 30 min by default. Tune via
`config.yaml`:

```yaml
notifications:
  dedup_window_minutes: 60
```

To stop pushes entirely without killing the loop, clear the ntfy
topic — log channel still fills in. To stop everything, `stop-all`
(reversible by `resume --system`).

## When you change config

Restart the dashboard:

```bash
launchctl unload ~/Library/LaunchAgents/com.claude247.dashboard.plist
launchctl load   ~/Library/LaunchAgents/com.claude247.dashboard.plist
```

(Or `scripts/install_launchd.sh` re-renders + reloads both jobs.)
