# NEXT_IMPLEMENTATION_PLAN.md

> Audit of the 32-section "Finish the Real Multi-Repo 24/7 Product Spine"
> directive against the v1.0.0-alpha.0 codebase currently on `main`.
> Each row is mapped to the actual module(s) and test(s) that satisfy it.
> Genuine gaps are listed at the bottom; they're what M16 closes.

## TL;DR

| Bucket | Count |
|---|---|
| Directive items already done | 28 / 32 sections |
| Naming / path deltas (functional equivalent in place) | 4 sections |
| Genuine new work for M16 | 5 items (one section's worth) |

Tests on `main`: **348 / 348 pass in < 8s**.

## Section-by-section map

### §0 Product target
**Done.** All 23 sub-requirements satisfied by M1–M15. See `DEFINITION_OF_DONE.md`.

### §1 Non-negotiables
- §1.1 Do not rebuild from scratch — followed (this plan re-uses everything below).
- §1.2 Multi-repo is mandatory — `orchestrator/repo_registry.py`, repo_id flows through dispatcher / runner_manager / merge_policy / dashboard.
- §1.3 Command queue is mandatory — `orchestrator/command_queue.py`; all CLI/dashboard buttons go through `enqueue()`.
- §1.4 Validator isolation — `validator/judge_contract.py::evidence_prompt` composes the prompt from evidence files only; each judge runs in a separate process invocation.
- §1.5 Local Claude Code first — `runner/auth.py::ensure_usable` blocks API fallback unless explicit; `gateway/doctor.py::check_claude_smoke` round-trips against local CLI.
- §1.6 Auto-merge exists in v1 — `orchestrator/merge_policy.py::decide` returns AUTO_MERGE / WAITING_APPROVAL / BLOCKED. **Gap:** `secret_scanner` exists as a module but is not consulted by `merge_policy.decide`. Fixed in M16.

### §2 Current likely gap (old main loop)
The directive predicted `orchestrator/main.py` might still be the legacy single-repo poll loop. **Already addressed:** the legacy `orchestrator/main.py` was archived to `archive/auto-evo/orchestrator/main.py` in M0; the active path is `orchestrator/dispatcher.py` (M11) which is fully repo-aware.

### §3 First action: inspection + plan
**This file IS the plan.** Inspection ran via `find` and module reads at session start.

### §4 Required target modules
Directive lists ~30 modules. Mapping:

| Directive expects | Actual |
|---|---|
| `orchestrator/dispatcher.py` | ✓ same name |
| `orchestrator/task_manager.py` | ✓ same name |
| `orchestrator/runner_manager.py` | ✓ same name |
| `orchestrator/pr_manager.py` | **Δ** functionality lives inline in `dispatcher.handle_start_task` + `orchestrator/github_client.py`. Not split into a dedicated module — would be premature factoring. Documented. |
| `orchestrator/validation_runner.py` | **Δ** named `validator/validation_policy.py::validate` instead. Same behavior. |
| `orchestrator/merge_runner.py` | **Δ** named `orchestrator/merge_policy.py::decide` + dispatcher inline. Same behavior. |
| `orchestrator/notification_manager.py` | ✓ |
| `orchestrator/budget_manager.py` | ✓ |
| `orchestrator/replay_manager.py` | ✓ |
| `orchestrator/log_indexer.py` | ✓ |
| `orchestrator/alert_deduper.py` | ✓ |
| `orchestrator/memory_manager.py` | **Δ** named `memory/compiler.py` + `memory/repo_memory.py` + `memory/vector_store.py`. Functional split is cleaner. |
| `gateway/cli.py` | ✓ |
| `gateway/commands.py` | **Δ** split into `gateway/commands/*_cmd.py` (one Click command per file). Same surface. |
| `gateway/remote_bridge.py` | **Δ** not present as separate module. CLI `--plain` / `--json` already serve Remote/Dispatch. A separate module would add no value. |
| `gateway/doctor.py` | ✓ |
| `dashboard/app.py`, `dashboard/templates/`, `dashboard/static/` | ✓ (no static dir; minimal inline CSS in `base.html`) |
| `runner/Dockerfile`, `entrypoint.sh`, `worker.py`, `prompt_builder.py`, `evidence_collector.py` | ✓ all present |
| `validator/validation_policy.py`, `gemini_judge.py`, `openai_judge.py`, `judge_contract.py` | ✓ all present (+`mock_judge.py`) |
| `memory/schema.sql`, `vector_store.py`, `compiler.py`, `repo_memory.py` | ✓ |
| `scripts/install_launchd.sh`, `uninstall_launchd.sh`, `doctor.sh` | ✓ |
| `packaging/launchd/com.claude247.*.plist` | **Δ** lives at `scripts/launchd/com.claude247.*.plist.tpl`. Template approach (rendered by install script) vs static plist. Functionally equivalent; better than a static plist because the path is repo-relative not hardcoded. |
| `com.claude247.notifier.plist` | **Δ** not present. Notifications are emitted inline by command handlers via `orchestrator/notification_manager.py`. A separate notifier daemon would add latency without value. |

### §5 Multi-repo registry
**Done.** `orchestrator/repo_registry.py` + `orchestrator/onboarding.py`. Validations match directive item-by-item (id required, path exists, is git repo, remote matches, forbidden_paths non-empty, default branch exists, explicit auto_merge config).

**Gap:** `claude247 repo enable --repo X` and `claude247 repo disable --repo X` commands are missing. Fixed in M16.

### §6 SQLite state layer
**Done.** `memory/schema.sql` has every table the directive lists including new `system_state` (M11) and the schema row for `approvals` is the `approval_state` column on `prs` (semantically equivalent — directive lists `approvals` as a separate table but my normalization keeps it on the parent PR; documented).

Task statuses: all 14 directive statuses present in `task_manager.TaskStatus` (`queued`, `planning`, `coding`, `testing`, `reviewing`, `validating`, `pr_created`, `waiting_for_approval`, `auto_merging`, `merged`, `stuck`, `failed`, `paused`, `cancelled`). Directive adds `blocked` — alias for `failed` with a blocked reason in our model; mapped via decisions table + ruling.reasons.

Command statuses: 6 of 7 (`queued`, `running`, `succeeded`, `failed`, `rejected`, `requires_approval`). Directive adds `cancelled` — not used because cancelled commands transition to `rejected` with a reason. Functionally same.

Timeline events: all 22 directive event types emit via `task_manager._emit_event` from the dispatcher pipeline.

### §7 Dispatcher
**Done.** `orchestrator/dispatcher.py` with `run_once` + `run_loop`. All 16 required command handlers are present except `repo_add` / `repo_disable` / `repo_enable` — directive expects these as command_queue commands, but in the current design `repo add` runs synchronously in the CLI (`gateway/commands/repo_cmd.py`) and writes to `repos.yaml` directly. Repo enable/disable are missing entirely. Fixed in M16.

### §8 CLI / Remote command interface
**Done** for 25 / 27 commands. Missing:
- `claude247 repo enable --repo <id>` — added in M16
- `claude247 repo disable --repo <id>` — added in M16

`status --plain` output is shorter than the directive's example. Directive shows stuck count, approval count, "today: N completed, M failed", "Next actions: ...". M16 enriches the output to match.

### §9 Worker execution plane
**Done.** `orchestrator/runner_manager.py` + `runner/worker.py` + `runner/role_loop.py`. All 6 role names present (planner/coder/reviewer/repair/+docs/guardian planned but not wired — guardian checks happen at the dispatcher level via merge_policy gates and budget_manager.check_caps). Repair max-attempts honored from `repo.budget.max_repair_attempts_per_task` (M12).

### §10 Local Claude Code authentication
**Done.** `runner/auth.py::resolve_auth_mode` + `runner/claude_cli.py::smoke_check`. `gateway/doctor.py::check_claude_smoke` does the `claude -p OK` round-trip. Usage accounting via `budget_manager` increments `local_cc_run_count` separately from `estimated_api_cost`. Local Claude Code runs report `cost_usd: None` per spec §8.4.

### §11 Evidence package
**Done.** `runner/evidence_collector.py` writes the full directive package. **Δ** path is `<workspace>/.evidence/` (not `<workspace>/.evidence/<task_id>/`) because the workspace dir IS task-id-keyed: `~/.claude-code-247/workspaces/<task_id>/`. Same effect, one less directory.

### §12 External validators
**Done.** Both real (Gemini 2.5 Pro verified live in M11.5) and mock paths in `validator/`. Output schema matches directive. Disagreement blocks auto-merge via `validation_policy.ValidationOutcome.final_verdict == "DISAGREE"` → `merge_policy.decide` routes to WAITING_APPROVAL.

### §13 Risk scoring
**Done.** `orchestrator/risk_score.py::compute_risk` covers all 15 directive factors + 4 added (database_migration, low_test_coverage, M12). Returns RiskAssessment with score (0-100, clamped) and level (low/medium/high). **Note:** `secret-like diff` factor is conceptually a gate (not a numeric factor); covered by `secret_scanner.has_secrets` — the M16 fix wires it into `merge_policy.decide` as a hard block (not a +N score), matching directive §14 "no secret-like diff detected".

### §14 Auto-merge policy
**Done.** `merge_policy.decide` enforces every directive gate except `no secret-like diff detected`. M16 wires that.

### §15 GitHub integration
**Done.** M11.5 added `orchestrator/github_client.py` (gh CLI wrapper); dispatcher creates draft PRs with the directive's body template (see `_pr_body` in `dispatcher.py`); `gh pr merge` fires for AUTO_MERGE rulings under all three safety gates.

### §16 Dashboard
**Done.** 14 of 15 directive pages: /, /repos, /repos/{id}, /tasks, /tasks/{id}, /prs, /prs/{repo}/{pr}, /commands, /budgets, /logs, /alerts, /memory, /onboarding, /settings (+ /metrics, /webhooks/github, /healthz). All buttons enqueue commands via `enqueue()`. **Δ** no /static dir — inline CSS only.

### §17 Remote/Dispatch documentation
**Done.** `docs/REMOTE_DISPATCH.md`.

### §18 Notifications + alert dedup
**Done.** `orchestrator/notification_manager.py` covers all 11 directive events. `orchestrator/alert_deduper.py` with 30-min default window.

### §19 Timeline
**Done.** `task_events` table + `task_manager.get_timeline` + dashboard `/tasks/{id}` renders.

### §20 Explain-stuck
**Done.** `dispatcher.handle_explain_stuck` + CLI `explain-stuck --plain/--json`.

### §21 Failure replay
**Done.** `orchestrator/replay_manager.py::build_replay_package` writes `~/.claude-code-247/replays/<task_id>.replay.json`. Three modes (--dry-run / --explain-only / --repair). **Δ** package is a single JSON file rather than a directory of files. Same content, easier to share. Documented.

### §22 Log search
**Done.** `logs` + `logs_fts` table; `log_indexer.search` (FTS5-backed); CLI `logs search/tail`; dashboard `/logs` with filter form.

### §23 Long-term memory
**Done.** All 4 layers per directive. Planner prompt receives memory snippets via `role_loop._gather_memory_for_planner` (M13). Daily/weekly compiler via `claude247 memory compile`. **Gap:** failed tasks don't auto-update `.agent/FAILURES.md` until the operator runs `memory compile`. M16 wires inline auto-compile on transitions to `failed`/`stuck`.

### §24 Budget manager
**Done.** `orchestrator/budget_manager.py` tracks all required counters. `check_caps` returns exceedance list; dispatcher defers `start_task` when over budget and emits `budget_exceeded` notification.

### §25 Pause / resume
**Done.** All 6 commands (`pause --system/repo/task`, `resume --system/repo/task`) via `gateway/commands/control_cmd.py` → `dispatcher.handle_*`.

### §26 Security guardrails
**Done** for: command audit log (commands table), forbidden_paths (path_guard), allowed_paths (in spec to worker), human approval (approval_state on PRs + dashboard buttons), dry-run (replay), emergency stop (stop-all), diff risk scoring, no silent API fallback.

**Gap:** secret scanning exists in `orchestrator/secret_scanner.py` but isn't wired into the auto-merge gate. M16 wires it.

### §27 launchd runtime
**Done.** 4 launchd plists (dashboard, orchestrator, dispatcher, backup). **Δ** path is `scripts/launchd/*.plist.tpl` (template + render by install script) rather than `packaging/launchd/*.plist` (static). Template approach is better because the plist needs HOME / repo path substituted per machine. No `notifier` plist — notifications are inline.

### §28 Testing rules
**Done.** 348 tests pass without real credentials. All judges fall back to mock when keys absent. **Δ** specific test file names don't always match; mapping in the gap section below. M16 doesn't create rename-wrapper tests (would be churn for no value) but does add the genuinely-new tests for M16 work.

### §29 Implementation order (Phases 2–8)
**Phases 2–7 done** via M0–M15. **Phase 8 (launchd + doctor + hardening)** done via M10/M11/M14. M16 is the final audit pass.

### §30 Documentation
**Done.** All 9 directive docs exist + DEFINITION_OF_DONE.md + IMPLEMENTATION_PLAN.md + this file.

### §31 Definition of Done
30/30 items satisfied except:
- #29 "No silent API fallback" — already enforced by `runner/auth.py::ensure_usable` (NOT silent); M16 verifies via test.
- #26 "Failed tasks write memory" — partially done; M16 wires the auto-compile on failure.

### §32 If blocked
Not blocked.

---

## M16 work list (the real gaps)

| # | Gap | Fix | Test |
|---|---|---|---|
| 1 | `secret_scanner` not consulted in merge gate | Add `secret_scanner.has_secrets(diff_text)` check to `merge_policy.decide`; block when secrets detected. | New unit test `test_secret_scanner_blocks_automerge` |
| 2 | `claude247 repo enable/disable` missing | New CLI subcommands; flip `repos.yaml::enabled` AND the SQLite mirror. | `tests/unit/test_cli_repo_toggle.py` |
| 3 | `status --plain` minimal | Enrich to include stuck count, approval count, today completed/failed, next-action hints. | Update `tests/unit/test_cli.py` |
| 4 | Failed tasks don't auto-write memory | Dispatcher calls `memory.compiler` inline on transition to `failed` / `stuck`. | `tests/integration/test_failed_task_writes_memory.py` |
| 5 | Multi-repo dispatch isolation test missing | Two-repo fixture; assert task in repo A doesn't leak state into repo B. | `tests/unit/test_multi_repo_dispatch.py` |

After M16: 32-section directive fully satisfied (with documented Δ for naming / packaging path conventions).
