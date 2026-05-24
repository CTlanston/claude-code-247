# AutoDev Migration Map

Reference: `AUTODEV_V3_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md` §9 Phase 1.

This document maps the **existing Auto-Evo inner engine** in this repo onto
the **AutoDev v3 outer loop** specified in the prompt. It's the input to
every other phase — every wrapping / refactor / new-module decision below
must trace back to a row here.

---

## Existing Components

| File | Role | Lines | Notes |
| --- | --- | --- | --- |
| `orchestrator/main.py` | State-machine loop, 4-role dispatch, TDD gate, forbidden-path check, rate-limit handling, terminal-error detection, CI-log feedback, Guardian invocation | 638 | The "inner engine" entry point |
| `orchestrator/runner.py` | Docker SDK + LOCAL_MODE branch, role config table, OAuth/API-key auto-routing, HOST_UID/GID coordination, container spawn/wait/teardown | ~230 | Already detects `sk-ant-oat01-` prefix |
| `orchestrator/git_proxy.py` | Worktree management, bare-remote management, GitHub mirror | ~185 | Owns the token-isolation boundary |
| `orchestrator/github_client.py` | Issues list/create, PR open/label, CI-run polling, CI-log extraction | ~243 | LOCAL_MODE has a file-backed stub |
| `orchestrator/circuit_breaker.py` | CI-failure-rate breaker + per-issue credit/retry-round breaker | ~43 | USD breaker was removed during subscription redesign |
| `orchestrator/db.py` | SQLite state (tasks, runs, metrics, audit) | ~168 | Has known double-write bug → issue #6 |
| `orchestrator/local_runner.py` | LOCAL_MODE stubs for planner/coder/reviewer/guardian + fault injection | ~394 | Dev/test path; never used in production |
| `orchestrator/roles/{planner,coder,reviewer,guardian}.md` | System prompts for each role | — | Baked into runner image too |
| `runner/Dockerfile` + `entrypoint.sh` | Headless `claude --print` invocation; OAuth/API-key auto-routing | — | CLI v2.1.133, OAuth via `CLAUDE_CODE_OAUTH_TOKEN` |
| `scripts/*.sh` | LOCAL_MODE run + 3 smoke tests | — | All passing as of last session |

## Existing Orchestrator Entry Points

- `python3 orchestrator/main.py` → infinite poll loop
- `docker compose up -d redis orchestrator` → containerised infinite loop
- `bash scripts/run-local.sh` → host-mode infinite loop (LOCAL_MODE=1)
- No one-shot mode existed before; AutoDev v3 supervisor adds this via
  `python3 -m autodev.supervisor --once` (delegates to inner engine in single-pass mode)

## Existing State Machine

```
queued → coding → ci_running → reviewing → human_review
                  ↑                ↓
                  └──── retry ─────┘  (max 5 review rounds, max 3 repair attempts)
                                  ↓
                                paused (on credit=0, terminal Anthropic error, RATE_LIMITED)
```

Persistent in `state/orchestrator.db:tasks`. AutoDev v3 mirrors this in
`reports/state.json` at the *task* level: `current_task_id`, `current_phase`,
`branch`, etc. The inner state machine remains the source of truth for the
task-execution state; the outer loop's state is about the *supervisor* state
(idle, running, paused, blocked).

## Existing Claude Code CLI Integration

- Image: `claude-code-247/runner:latest`
- Binary: `/usr/local/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-linux-arm64/claude`
- Version: 2.1.133
- Flags used (verified live): `--print --model --append-system-prompt --allowedTools --output-format json --permission-mode bypassPermissions`
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` for subscription, `ANTHROPIC_API_KEY` for API
- Output JSON envelope: `{result, is_error, total_cost_usd, usage{...}, num_turns, duration_ms, ...}`

## Existing Anthropic SDK Usage

Only one place: `orchestrator/local_runner.py:_call_anthropic_sdk()`, gated
by `LOCAL_USE_SDK=1` env var (default 0). The cost controller will tighten
this further so that under `cost.mode=cheap` the SDK path is forcibly disabled
regardless of env.

## Existing Docker / Sandbox Flow

- Orchestrator container talks to host Docker daemon via `/var/run/docker.sock`
- Each role-run = ephemeral runner container, `mem_limit=4g`, `nano_cpus=2_000_000_000`, `network_mode=bridge`
- Workspaces bind-mounted via `WORKSPACE_ROOT_HOST` (compose-resolved host path)
- State dir bind-mounted via `STATE_DIR_HOST`
- Roles read prompts from baked `/system_prompts/<role>.md` (no bind-mount)
- 30-min container wall-clock timeout via `container.wait(timeout=1800)`

## Existing GitHub Integration

- `PyGithub` for issues/PRs/workflow-runs/labels
- `httpx` for raw job-log fetch (PyGithub doesn't expose blob-storage redirects cleanly)
- Token in `GITHUB_TOKEN` env var; PAT or fine-grained — both forms handled
- Push path: orchestrator clones with token in URL, runner pushes directly back to GitHub (token visible to runner container — known gap; designed pattern was bare-repo proxy but mirror is no-op in current setup)

## Existing CI Feedback Loop

- `latest_workflow_run_status(branch)` → success | failure | running | None
- On failure: `latest_workflow_failure_summary(branch)` → fetches job logs, extracts error-relevant lines via `_extract_error_lines()` regex, stuffs into `tasks.last_error`
- On next coding round, `_do_coding` includes `last_error` in retry prompt — Coder sees the actual ruff / pytest / coverage error

## Existing Guardian / Reviewer Logic

- Reviewer: separate Opus 4.7 invocation, read-only tools (`Read,Grep,Glob,Bash`), system prompt at `roles/reviewer.md`. Verdict: `approve` | `request_changes` with comments.
- Guardian: separate Opus 4.7 invocation every `GUARDIAN_INTERVAL_MINUTES` (was 30, bumped to 240 to avoid dev-loop spam). Output: `health: 0..100`, `alerts: []`, `recommendation: continue|pause|stop`.
- TDD invariant check + forbidden-path check run **before** the Reviewer model fires (cheap deterministic gates).

## Existing Slack / Alert Logic

- Single function `_slack(text)` in `main.py` posts to `SLACK_WEBHOOK_URL`
- Emits on: terminal Anthropic error, rate-limit trip, rate-limit auto-resume, circuit-breaker open, Guardian pause/stop recommendation
- AutoDev v3 adds: daily-summary post, blocker post, human-hold post via the same webhook

## Existing Rate-Limit / Backoff Logic

- Detection: `_is_rate_limit_error()` keyword + HTTP 429 check
- State: `state/RATE_LIMITED` file containing unix-timestamp of resume time
- Loop honours `RATE_LIMITED` like `PAUSED` (skips dispatch until window expires)
- Auto-clears on expiry + Slack post

## Existing Tests

- `scripts/test-tdd-gate.sh` — Reviewer rejects no-test PR, retry cap fires
- `scripts/test-circuit-breaker.sh` — rate-limit backoff fires, flag auto-clears
- `scripts/test-paused-flag.sh` — PAUSED kill-switch freezes/resumes
- All three PASS in LOCAL_MODE on the current `main.py`.

---

## What to Keep Unchanged

| File | Why |
| --- | --- |
| `orchestrator/main.py` (all 638 lines, INCLUDING the `_is_subscription` hotfix from commit A) | Hotfix is load-bearing; rewriting it would re-introduce the phantom-cost freeze |
| `orchestrator/runner.py` | Working OAuth/API routing + Docker spawn logic |
| `orchestrator/git_proxy.py`, `github_client.py`, `circuit_breaker.py`, `db.py`, `local_runner.py` | All proven via the previous live runs |
| `runner/Dockerfile`, `runner/entrypoint.sh` | CLI flags + permissions verified |
| `runner/roles/*.md` | Role contracts; changing them invalidates the proven loop |

## What to Wrap

- `orchestrator/main.py` → wrap via `autodev/inner_engine.py:InnerEngine.run_task()`. The wrapper invokes the existing loop in a one-shot mode (terminate after one full `_process_one` cycle per task) instead of the existing infinite loop.
- `orchestrator/github_client.py` → wrapped by `autodev/ci_feedback.py` for the CI summary extraction; not re-implemented.
- `orchestrator/runner.py` → wrapped by `autodev/sandbox_runner.py` for the Docker-spawn surface.
- Existing Slack `_slack()` → wrapped by `.claude/hooks/notify.sh` so notifications can fire from outside Python too.

## What to Refactor Carefully

- `orchestrator/main.py`'s outer `while True:` is the *only* part that conflicts with the AutoDev supervisor's outer loop. The inner-engine adapter calls **one iteration** of that loop, then returns. Implementation: refactor `main()` slightly so the loop body is extracted into a `tick()` function that can be called once. Spec §2.1 allows "adapters and wrappers over destructive refactors" — this is a minimal extraction, not a destructive refactor, and it preserves all existing semantics.

## What to Deprecate

- Nothing yet. The existing `scripts/run-local.sh` may eventually be replaced by `scripts/autodev_once.sh --local`, but both can coexist.

## New AutoDev v3 Modules

| Module | Purpose | Spec ref |
| --- | --- | --- |
| `autodev/project_state.py` | Read/write `reports/state.json` atomically | §6, Phase 3 |
| `autodev/recovery_manager.py` | Decide next action after a restart | Phase 3 |
| `autodev/backlog_manager.py` | Parse `tasks/backlog.md`, pick next task | Phase 4 |
| `autodev/command_manager.py` | Parse `commands/inbox.md`, idempotent | Phase 4 |
| `autodev/cost_policy.py` | cheap/balanced/premium gating | Phase 5 |
| `autodev/executors/claude_code_cli.py` | Subscription-first execution adapter | Phase 6 |
| `autodev/prompt_builder.py` | Compact recovery prompt builder | Phase 7 |
| `autodev/inner_engine.py` | Wraps existing `orchestrator/main.py` | Phase 8 |
| `autodev/sandbox_runner.py` | Wraps existing `runner.py` Docker spawn | Phase 9 |
| `autodev/ci_feedback.py` | Wraps existing CI-log extraction | Phase 9 |
| `autodev/supervisor.py` | Outer loop / one-cycle entry point | Phase 10 |
| `autodev/report_manager.py` | Generates daily/session/run-history reports | Phase 11 |
| `scripts/autodev_{once,supervisor,status,report,doctor}.sh` | Shell entry points | Phase 10 |
| `.claude/agents/autodev-*.md` | Project subagent definitions | Phase 13 |
| `.claude/hooks/{notify,stop_summary,pre_tool_guard}.sh` | Lifecycle hooks | Phase 12 |
| `scripts/{start_remote_control,start_tmux_autodev,install_launchd_autodev}.sh` | Mobile/remote control | Phase 14 |

## Migration Risks

1. **Inner loop ↔ outer loop coupling.** The supervisor calls `InnerEngine.run_task()` which (in the simplest implementation) shells out to a one-shot `python3 -m orchestrator.main --one-shot` — but `main.py` currently has no `--one-shot` flag. We add one minimally (no behavioural change to the steady-state loop).
2. **Subscription quota propagation.** The outer loop polls every 15 minutes by default (`AUTODEV_INTERVAL_SECONDS=900`); the inner engine polls every 15 seconds. If the outer loop kicks off multiple inner ticks in parallel, we'd burn quota. Mitigation: outer loop is strictly serial; the existing `RATE_LIMITED` flag is honoured.
3. **`record_run` double-write** (issue #6) is unfixed. The `_is_subscription` hotfix masks the symptom in Guardian, but daily cost reporting under API mode (if ever re-enabled) would still be wrong. Issue #6 tracks this; not a Phase-0..18 blocker.
4. **HUMAN_CONFIG missing** → defaults are safe (cheap, no live, no autostart). Phase 17/18 won't run until human flips the flags.
5. **No host `claude` CLI** → executor falls back to Docker. Mitigates: the CLI executor's `run()` method probes both code paths.

---

## How the AutoDev outer loop calls the inner engine

```
scripts/autodev_supervisor.sh   (every AUTODEV_INTERVAL_SECONDS)
  → scripts/autodev_once.sh
    → python3 -m autodev.supervisor --once
      → autodev/recovery_manager.py: decide next action
        ├─ "continue_current_task"
        ├─ "select_new_task" → autodev/backlog_manager.py: pick from backlog.md
        ├─ "pause" / "hold_for_human" → exit 0
        └─ "report_only" → autodev/report_manager.py: write daily.md, exit 0
      → autodev/inner_engine.py: InnerEngine.run_task(task, state, cost_policy)
        → subprocess: python3 -m orchestrator.main --one-shot --task <id>
          (the existing main.py loop body, called exactly once)
      → autodev/report_manager.py: write state.json, session-log.md, daily.md
      → exit
```

The supervisor is restartable at every arrow above. Each component reads its
inputs from disk and writes its outputs atomically.
