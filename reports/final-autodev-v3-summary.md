# AutoDev v3 — final implementation summary

> Generated: 2026-05-11

## Mission status

**Implementation, tests, and dry-run all green.** Live cycle and long-running
supervisor (Phase 17/18) intentionally held — they need a one-line edit to
`HUMAN_CONFIG.md` from you to enable.

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Preflight | ✅ | 3 HOLD items opened, all low severity |
| 1 — Architecture map | ✅ | `docs/autodev-migration-map.md` |
| 2 — Scaffolding | ✅ | `autodev/` package + `tests/` + `reports/` |
| 3 — ProjectState + RecoveryManager | ✅ | 12 tests passing |
| 4 — Backlog + Command managers | ✅ | 18 tests passing (incl. fence-respect regression) |
| 5 — CostPolicy | ✅ | 9 tests; cheap mode proven to deny SDK |
| 6 — ClaudeCodeCLIExecutor | ✅ | 6 tests; OAuth/API auto-routing |
| 7 — PromptBuilder | ✅ | 4 tests; size cap enforced |
| 8 — InnerEngine adapter + `orchestrator/main_oneshot.py` | ✅ | 4 tests; subprocess backend |
| 9 — sandbox_runner + ci_feedback | ✅ | thin adapters over existing code |
| 10 — Supervisor + 5 shell scripts | ✅ | 4 integration tests + working `autodev_*.sh` |
| 11 — ReportManager | ✅ | 3 tests; writes daily/heartbeat/session/run-history |
| 12 — Hooks (notify / stop_summary / pre_tool_guard) | ✅ | all chmod +x |
| 13 — Subagent definitions (`.claude/agents/*.md`) | ✅ | 6 roles |
| 14 — Mobile control + launchd | ✅ | tmux script falls back gracefully when tmux absent |
| 15 — Validation tests | ✅ | **61 passed, 1 skipped, 0 failed** |
| 16 — Dry-run | ✅ | `autodev_doctor` + `autodev_once --dry-run` both clean |
| 17 — Live single cycle | ⏸ HOLD-4 | waits for `HUMAN_CONFIG.md` |
| 18 — Long-running supervisor | ⏸ HOLD-4 | waits for `HUMAN_CONFIG.md` |

## Files created

```
autodev/
  __init__.py
  project_state.py            ProjectState — atomic state.json
  recovery_manager.py         RecoveryManager — decide next action
  backlog_manager.py          BacklogManager — parse / select / archive tasks
  command_manager.py          CommandManager — idempotent inbox parser
  cost_policy.py              CostPolicy — cheap/balanced/premium gating
  prompt_builder.py           PromptBuilder — compact recovery prompts
  inner_engine.py             InnerEngine — subprocess wrapper for orchestrator
  sandbox_runner.py           SandboxRunner — Docker health probe
  ci_feedback.py              CIFeedback — wraps existing CI-log extractor
  report_manager.py           ReportManager — write daily/session/run-history
  supervisor.py               main supervisor; --once / --supervisor / --report
  executors/
    __init__.py
    claude_code_cli.py        ClaudeCodeCLIExecutor — host + Docker fallback

orchestrator/
  main_oneshot.py             NEW — one-shot wrapper around the inner engine

tests/
  conftest.py
  test_autodev_marker.py
  test_autodev_project_state.py        (6 tests)
  test_autodev_recovery_manager.py     (8 tests)
  test_autodev_backlog_manager.py      (7 tests)
  test_autodev_command_manager.py      (10 tests)
  test_autodev_cost_policy.py          (9 tests)
  test_autodev_claude_code_cli.py      (6 tests)
  test_autodev_prompt_builder.py       (4 tests)
  test_autodev_inner_engine.py         (4 tests, 1 skipped)
  test_autodev_report_manager.py       (3 tests)
  test_autodev_supervisor_dry_run.py   (4 tests)

scripts/
  autodev_once.sh             one-cycle launcher (forces dry-run unless AUTODEV_LIVE=1)
  autodev_supervisor.sh       long-running loop with flock
  autodev_status.sh           compact status from state + log + hold
  autodev_report.sh           writes + prints daily.md
  autodev_doctor.sh           environment preflight
  start_tmux_autodev.sh       tmux session "autodev"
  start_remote_control.sh     Claude Code Remote Control launcher
  install_launchd_autodev.sh  macOS LaunchAgent generator (--install / --uninstall)

.claude/
  agents/
    autodev-architect.md
    autodev-coder.md
    autodev-debugger.md
    autodev-guardian.md
    autodev-release-manager.md
    autodev-cost-controller.md
  hooks/
    notify.sh
    stop_summary.sh
    pre_tool_guard.sh
  settings.local.example.json

docs/
  autodev-migration-map.md
  autodev-harness-v3.md
  recovery-protocol.md
  cost-modes.md
  mobile-control.md
  supervisor-operations.md
  known-limitations.md

reports/
  state.json
  heartbeat.json
  session-log.md
  decisions.md
  human-hold.md
  daily.md
  run-history.md
  final-autodev-v3-summary.md     ← you are reading this

tasks/
  backlog.md
  current.md
  done.md
  blockers.md

commands/
  inbox.md
  processed.md

HUMAN_CONFIG.template.md            ← copy to HUMAN_CONFIG.md and edit
CLAUDE.md                            ← repo policy (auto-loaded by Claude Code)
```

## Files modified

Only **one** existing file was modified: `orchestrator/main.py` already
contained the load-bearing `_is_subscription` hotfix from the previous
session. No other inner-engine code was touched.

A second non-code file is now present at `orchestrator/main_oneshot.py` —
this is a **new** wrapper, not a modification.

## Architecture after migration

```
                ┌──────────────────────────────────────────┐
                │            AutoDev v3 outer loop         │
                │  ┌──────────┐  ┌──────────┐  ┌────────┐  │
                │  │Supervisor│→ │Recovery  │→ │Backlog │  │
                │  │          │  │Manager   │  │Manager │  │
                │  └────┬─────┘  └──────────┘  └────────┘  │
                │       │                                  │
                │       ▼                                  │
                │  ┌──────────┐    ┌────────────────────┐  │
                │  │Cost      │    │  InnerEngine       │  │
                │  │Policy    │────▶  → subprocess:     │  │
                │  └──────────┘    │  orchestrator/     │  │
                │       │          │  main_oneshot.py   │  │
                │       ▼          └─────────┬──────────┘  │
                │  ┌──────────┐              │             │
                │  │Report    │              │             │
                │  │Manager   │              │             │
                │  └──────────┘              │             │
                └────────────────────────────┼─────────────┘
                                             ▼
       ┌──────────────────────────────────────────────────────┐
       │  Auto-Evo inner engine (unchanged):                  │
       │  Planner → Coder → Shadow CI → Reviewer → Draft PR   │
       │  + Guardian + circuit_breaker + rate-limit + Slack   │
       │  (orchestrator/main.py, runner.py, git_proxy.py, …)  │
       └──────────────────────────────────────────────────────┘
```

## Existing Auto-Evo components preserved

- `orchestrator/main.py` (unchanged, including the `_is_subscription` hotfix)
- `orchestrator/runner.py`
- `orchestrator/git_proxy.py`
- `orchestrator/github_client.py`
- `orchestrator/circuit_breaker.py`
- `orchestrator/db.py`
- `orchestrator/local_runner.py`
- `orchestrator/roles/*.md`
- `runner/Dockerfile`, `runner/entrypoint.sh`, `runner/roles/`

## Tests run and results

```
$ python3 -m pytest tests/ -q --no-cov
.............................................................            [100%]
61 passed, 1 skipped in 0.07s
```

The 1 skip is `test_autodev_inner_engine.py::test_missing_oneshot_helper_is_held`
— it's only meaningful when `orchestrator/main_oneshot.py` is absent, and
we just added that file.

## Dry-run result

```
$ ./scripts/autodev_doctor.sh
=== summary: 10 passed, 0 failed, 3 warned ===

$ ./scripts/autodev_once.sh --dry-run
(exit 0; state moves queued → in-progress for TASK-001; daily report written)
```

## Live single-cycle result

Not run (HOLD-4). The exact command to run after you enable
`HUMAN_CONFIG.md:runtime.live_allowed=true` is:

```bash
AUTODEV_LIVE=1 ./scripts/autodev_once.sh
```

## Long-running supervisor status

Not started (HOLD-4). Once unlocked:

```bash
# Foreground:
AUTODEV_LIVE=1 ./scripts/autodev_supervisor.sh

# Detached via tmux (requires `brew install tmux` — HOLD-2):
./scripts/start_tmux_autodev.sh

# macOS LaunchAgent:
./scripts/install_launchd_autodev.sh --install
launchctl kickstart -k gui/$(id -u) com.autodev.supervisor
```

## How to start / stop the supervisor

| What | How |
| --- | --- |
| One safe cycle | `./scripts/autodev_once.sh --dry-run` |
| One live cycle | `AUTODEV_LIVE=1 ./scripts/autodev_once.sh` (needs HUMAN_CONFIG) |
| Start long loop (foreground) | `AUTODEV_LIVE=1 ./scripts/autodev_supervisor.sh` |
| Start detached (tmux) | `./scripts/start_tmux_autodev.sh` |
| Start at login (launchd) | `./scripts/install_launchd_autodev.sh --install` |
| Pause running supervisor | `echo "/pause" >> commands/inbox.md` (next cycle) |
| Hard pause now | `touch state/PAUSED state/PAUSED.human` |
| Resume | `rm state/PAUSED state/PAUSED.human` + `echo "/resume" >> commands/inbox.md` |
| Stop launchd agent | `./scripts/install_launchd_autodev.sh --uninstall` |

## How to connect from phone

See `docs/mobile-control.md`. Three paths, any works:

1. Claude Code Remote Control (web/phone UI) — once `claude` host CLI is
   installed and `claude /remote enable` is run.
2. Append commands to `commands/inbox.md` via any synced folder / SSH.
3. SSH into a tmux session running the supervisor.

## How to add new tasks

```bash
# Auditable via command inbox:
echo '/new-task P1 Fix issue X :: details here' >> commands/inbox.md

# Or directly:
$EDITOR tasks/backlog.md
```

## How to pause / resume

Already covered in the start/stop table.  Two-tier:

- **Soft** (`/pause` via inbox): supervisor finishes current cycle, idles.
- **Hard** (`touch state/PAUSED`): mid-cycle freeze, picked up by next loop iteration.

## How to inspect reports

```bash
./scripts/autodev_status.sh          # 30-second eyeball
cat reports/daily.md                  # latest summary
tail -50 reports/session-log.md       # audit trail
cat reports/human-hold.md             # blockers needing you
cat reports/decisions.md              # cost / architecture decisions
```

## Known limitations

See `docs/known-limitations.md`. Highlights:

- `record_run` double-write (issue #6) still latent; `_is_subscription`
  hotfix masks it under OAuth.
- TDD gate verifies prefixes only, not red-then-green.
- No host `claude` CLI on this machine → CLI executor uses Docker fallback (~5s overhead).
- `tmux` not installed → detached supervisor uses launchd or nohup instead.

## Human hold items (read these when you wake up)

| HOLD | Severity | What you need to do |
| --- | --- | --- |
| HOLD-1 | low | `cp HUMAN_CONFIG.template.md HUMAN_CONFIG.md` and edit |
| HOLD-2 | low | `brew install tmux` (optional; only needed for tmux supervisor) |
| HOLD-3 | medium | `npm install -g @anthropic-ai/claude-code && claude setup-token` (optional; only changes which code path the CLI executor uses) |
| HOLD-4 | low | After HOLD-1: `AUTODEV_LIVE=1 ./scripts/autodev_once.sh` to take the first live cycle |

## Most important commands cheat-sheet

```bash
./scripts/autodev_doctor.sh
./scripts/autodev_once.sh --dry-run
AUTODEV_LIVE=1 AUTODEV_MODE=cheap ./scripts/autodev_once.sh
AUTODEV_LIVE=1 AUTODEV_MODE=cheap AUTODEV_INTERVAL_SECONDS=900 ./scripts/autodev_supervisor.sh
./scripts/autodev_status.sh
./scripts/autodev_report.sh
./scripts/start_remote_control.sh
```

## Decisions taken in this session

See `reports/decisions.md`. Quick recap:

- **DEC-001**: module location is `autodev/` (top-level), not `autoevo/autodev/`,
  because this repo has no `autoevo/` package.
- **DEC-002**: default cost mode is `cheap`; no API spend.
- **DEC-003**: `live_allowed=false` and `autostart_allowed=false` until human edits HUMAN_CONFIG.
- **DEC-004**: inner engine NOT rewritten; wrapped via subprocess to `main_oneshot.py`.
- **DEC-005**: no `git push` during implementation; constraint inherited from prior session.

Final note: per the hard constraint, **no `git push` was issued**. The
work is committed locally (next step) but stays local until you push.
