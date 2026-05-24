# AutoDev Harness v3 — Operator's Guide

> Reference: `AUTODEV_V3_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md`

## What this is

AutoDev v3 is the **outer loop** around the existing Auto-Evo inner engine
(`orchestrator/`). It survives session death by externalising every piece of
working memory:

```
reports/state.json          machine-readable supervisor state
reports/heartbeat.json      last-cycle timestamp
reports/session-log.md      append-only audit trail
reports/daily.md            human-readable daily summary
reports/run-history.md      one line per cycle
reports/decisions.md        cost / architecture decisions
reports/human-hold.md       blockers needing human action
tasks/backlog.md            ordered queue (P0/P1/P2)
tasks/current.md            what's being worked on
tasks/done.md               archive
tasks/blockers.md           short pointer to hold items
commands/inbox.md           /pause /resume /new-task ...
commands/processed.md       archive (idempotency)
```

## Architecture diagram

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
                │  │Cost      │    │  Inner Engine      │  │
                │  │Policy    │────▶  (orchestrator/    │  │
                │  └──────────┘    │   main_oneshot.py) │  │
                │       │          └────────────────────┘  │
                │       ▼                                  │
                │  ┌──────────┐                            │
                │  │Report    │                            │
                │  │Manager   │                            │
                │  └──────────┘                            │
                └──────────────────────────────────────────┘
                              │
                              ▼
       ┌──────────────────────────────────────────────────────┐
       │  Auto-Evo inner engine (unchanged):                  │
       │  Planner → Coder → Shadow CI → Reviewer → Draft PR   │
       │  + Guardian + circuit_breaker + rate-limit + Slack   │
       └──────────────────────────────────────────────────────┘
```

## One-cycle flow

```
$ ./scripts/autodev_once.sh
  → load reports/state.json
  → process commands/inbox.md  (move applied to processed.md)
  → if paused or critical hold → write daily.md + exit 0
  → RecoveryManager.decide_next_action()
       ├ CONTINUE_CURRENT   re-tick the same task
       ├ SELECT_NEW         pick from backlog.md, mark .  in_progress
       ├ PAUSE              skip work
       ├ HOLD_FOR_HUMAN     critical blocker
       ├ REPAIR_STATE       just bootstrapped
       └ REPORT_ONLY        /report command
  → InnerEngine.run_task(task, state)
       (dry-run unless AUTODEV_LIVE=1 AND state.live_allowed=true)
  → ReportManager.cycle_finished(...)
  → save state.json
  → exit
```

## Two modes

- **Dry-run** (default): inner engine is NOT invoked; the supervisor just
  exercises decision logic, reads state, writes reports. Safe to run on
  any machine. `./scripts/autodev_once.sh --dry-run`.

- **Live**: inner engine actually invokes the 4-role pipeline against the
  real GitHub test repo. Requires `AUTODEV_LIVE=1` env AND
  `runtime.live_allowed=true` in `HUMAN_CONFIG.md`.

## Critical paths

- Inner engine wrapper: `autodev/inner_engine.py` → subprocess to
  `orchestrator/main_oneshot.py`.
- Cost gating: every paid-API call site MUST consult
  `autodev/cost_policy.py:CostPolicy.is_executor_allowed()`.
- Hold-on protocol: any blocker writes `HOLD-<n>` to
  `reports/human-hold.md` and the supervisor moves on.

## Commands you'll actually use

```bash
./scripts/autodev_doctor.sh            # env preflight
./scripts/autodev_once.sh --dry-run    # safe one cycle
./scripts/autodev_status.sh            # status from state + log
./scripts/autodev_report.sh            # write & dump daily.md

# After HUMAN_CONFIG.md grants live + autostart:
AUTODEV_LIVE=1 ./scripts/autodev_once.sh
AUTODEV_LIVE=1 ./scripts/autodev_supervisor.sh

# Detached:
./scripts/start_tmux_autodev.sh
# or:
./scripts/install_launchd_autodev.sh --install
launchctl kickstart -k gui/$(id -u) com.autodev.supervisor
```
