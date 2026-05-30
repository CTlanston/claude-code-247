# Operations

Day-to-day operation of the **TypeScript daemon** (port 7247, launchd job
`com.claude247.daemon`). State lives under `~/.claude-code-247/` (`AEDEV_HOME`).

> Note: the rich `claude247 …` Python CLI from v1 is **not yet ported** to the
> TS runtime. Until it is, day-to-day control is via the **dashboard / Operator
> Cockpit** at `http://127.0.0.1:7247` plus the HTTP API below.

## Start of day

```bash
bash scripts/doctor.sh                         # env + daemon health
curl -fsS http://127.0.0.1:7247/health         # {"status":"green"}
open http://127.0.0.1:7247                      # dashboard overview
```

If `doctor.sh` reports the daemon is not responding, (re)install/start it:

```bash
bash scripts/install_launchd.sh                # idempotent: re-render + reload
```

## Lifecycle

| Want to… | Do |
|---|---|
| Start / install 24/7 | `bash scripts/install_launchd.sh` |
| Stop (keep plist + state) | `bash scripts/uninstall_launchd.sh` |
| Stop + remove plist & logs | `bash scripts/uninstall_launchd.sh --purge` |
| Restart after a config/code change | `launchctl kickstart -k gui/$(id -u)/com.claude247.daemon` (or uninstall + install) |
| Confirm the job is loaded | `launchctl list \| grep com.claude247.daemon` |

## Where to look

| Thing | Location (`AEDEV_HOME` = `~/.claude-code-247/aedev-daemon`) |
|---|---|
| Daemon stdout/stderr | `$AEDEV_HOME/logs/daemon.{out,err}.log` |
| State DB | `$AEDEV_HOME/state.db` |
| Evidence / daily summaries | `$AEDEV_HOME/state/` (e.g. `daily-summary/<date>.md`) |
| Live event stream | `GET http://127.0.0.1:7247/events/stream` (SSE) |
| System + missions | `GET /status`, `GET /missions`, `GET /approvals` |
| One mission overview | `GET /missions/<id>/overview` |

## Operator Cockpit

The guided flow (brainstorm → PRD/ADR/roadmap → approve → execute → evidence
gate) runs in the dashboard. For local development of the cockpit specifically:

```bash
pnpm cockpit:dev        # daemon :7247 + dashboard :7248 with live reload
```

## Safety / pausing

- `system.allow_remote_writes` defaults **false**: no push/PR/merge happens
  until explicitly enabled AND the repo is `enabled`. The draft-PR gate returns
  `REMOTE_WRITES_DISABLED` while off — this is a safety state, not an error.
- Validators run on **evidence only**; missing Gemini/OpenAI keys report
  `not_configured` and are never treated as a pass.
- To quiet phone pushes without stopping the loop, clear the ntfy topic; the log
  channel still records everything.

## When something is off

1. `tail -f ~/.claude-code-247/logs/daemon.err.log`
2. `bash scripts/doctor.sh`
3. Dashboard → mission overview for the stuck mission (stage, holds, evidence).
4. Holds are surfaced as `operator.hold_created` / `*.hold.*` events and on the
   dashboard; resolve the underlying blocker, then re-run from the cockpit.
