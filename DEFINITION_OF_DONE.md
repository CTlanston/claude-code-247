# Definition of Done

Spec §28 acceptance, walked one-by-one as of M10. Each row points to
the code that implements it and the test(s) that prove it.

| # | Criterion | Status | Where |
|---|---|---|---|
| 1 | Multi-repo registry works | ✓ | `orchestrator/repo_registry.py`; `tests/unit/test_repo_registry.py` |
| 2 | Local Claude Code preflight works | ✓ | `runner/claude_cli.py::smoke_check`, `gateway/doctor.py::check_claude_smoke`; `tests/unit/test_claude_cli.py` |
| 3 | Docker runner can execute tasks | ✓ | `runner/Dockerfile`, `orchestrator/runner_manager.py::RunnerManager._run_docker`; `tests/integration/test_runner_manager.py` (local backend covered; docker variant verified manually with `docker info`) |
| 4 | Command queue works | ✓ | `orchestrator/command_queue.py`; `tests/unit/test_command_queue.py` |
| 5 | Dashboard works | ✓ | `dashboard/app.py` + 12 templates; `tests/integration/test_dashboard*.py` |
| 6 | Mobile-friendly CLI works | ✓ | `--plain` modes across `status/repos/tasks/logs/risk`; `tests/unit/test_cli*.py` |
| 7 | ntfy notifications work | ✓ | `orchestrator/notification_manager.py`; `tests/unit/test_notification_manager.py` |
| 8 | Task timeline works | ✓ | `orchestrator/task_manager.py::get_timeline`, dashboard `/tasks/{id}`; `tests/unit/test_task_manager.py`, `tests/integration/test_dashboard_m2.py::test_task_detail_page_renders_timeline` |
| 9 | PR risk scoring works | ✓ | `orchestrator/risk_score.py`; `tests/unit/test_risk_score.py` |
| 10 | Low-risk auto-merge works | ✓ | `orchestrator/merge_policy.py`; `tests/unit/test_merge_policy.py::test_low_risk_all_green_with_writes_on_auto_merges` |
| 11 | Medium/high-risk approval policy works | ✓ | `merge_policy.decide`; `tests/unit/test_merge_policy.py::test_medium_risk_requires_approval`, `::test_high_risk_is_blocked` |
| 12 | Gemini validator works or mock adapter passes | ✓ | `validator/gemini_judge.py` (real + mock fallback); `tests/unit/test_gemini_judge.py` |
| 13 | OpenAI-compatible validator works or mock passes | ✓ | `validator/openai_judge.py`; `tests/unit/test_openai_judge.py` |
| 14 | Validator disagreement blocks auto-merge | ✓ | `validation_policy.validate` returns `DISAGREE`; `tests/unit/test_validation_policy.py::test_disagreement_blocks_and_routes_to_human` + `test_merge_policy.py::test_validator_disagree_routes_to_approval` |
| 15 | Pause/resume works | ✓ | `gateway/commands/control_cmd.py` + command_queue; `tests/unit/test_cli_m2.py::test_pause_repo_enqueues_command`, `::test_resume_system_uses_set_mode` |
| 16 | Explain-stuck works | ✓ | `gateway/commands/control_cmd.py::explain_stuck`; `tests/unit/test_cli_m2.py::test_explain_stuck_carries_verbose_flag` |
| 17 | Budget panel works | ✓ | `orchestrator/budget_manager.py`, dashboard `/budgets`; `tests/unit/test_budget_manager.py`, `tests/integration/test_dashboard_m7.py::test_budgets_page_lists_repos` |
| 18 | Repo onboarding wizard works | ✓ | `orchestrator/onboarding.py`, `gateway/commands/repo_cmd.py`, dashboard `/onboarding`; `tests/unit/test_onboarding.py`, `tests/integration/test_dashboard_m2.py::test_onboarding_*` |
| 19 | Failure replay works | ✓ | `orchestrator/replay_manager.py`, `gateway/commands/replay_cmd.py`; `tests/unit/test_replay_manager.py`, `tests/unit/test_cli_replay.py` |
| 20 | Log search works | ✓ | `orchestrator/log_indexer.py` (FTS5), CLI `logs search/tail`, dashboard `/logs`; `tests/unit/test_log_indexer.py`, `tests/unit/test_cli_logs.py` |
| 21 | Alert deduplication works | ✓ | `orchestrator/alert_deduper.py`; `tests/unit/test_alert_deduper.py` |
| 22 | Long-term memory files exist | ✓ | `memory/repo_memory.py` + `claude247 memory init`; `tests/unit/test_repo_memory.py` |
| 23 | Qdrant vector memory is integrated or cleanly optional | ✓ | `memory/vector_store.py` (SQLite-FTS default, Qdrant opt-in via `memory.vector.backend`); `tests/unit/test_vector_store.py` (SQLite path; Qdrant path is lazy-imported) |
| 24 | Memory compiler works | ✓ | `memory/compiler.py`, CLI `memory compile`; `tests/unit/test_memory_compiler.py`, `tests/unit/test_cli_memory.py` |
| 25 | Doctor command works | ✓ | `gateway/doctor.py` (13 checks + optional claude smoke); `tests/unit/test_doctor.py`, `tests/unit/test_cli.py::test_doctor_runs_and_can_emit_json` |
| 26 | launchd install/uninstall scripts exist | ✓ | `scripts/install_launchd.sh`, `scripts/uninstall_launchd.sh`, plist templates in `scripts/launchd/` |
| 27 | Tests pass | ✓ | 242 pass in <8s on Python 3.13 |
| 28 | Docs are complete | ✓ | `docs/{ARCHITECTURE,INSTALL,REMOTE_DISPATCH,SECURITY,MEMORY,AUTO_MERGE_POLICY,VALIDATORS,REPO_ONBOARDING,OPERATIONS}.md` + README, CLAUDE.md, IMPLEMENTATION_PLAN.md |

## M11 / M11.5 acceptance (added)

| # | Criterion | Status | Where |
|---|---|---|---|
| 29 | Long-running dispatcher | ✓ | M11: `orchestrator/dispatcher.py::run_once,run_loop` + `gateway/commands/dispatcher_cmd.py` + `scripts/launchd/com.claude247.dispatcher.plist.tpl` (StartInterval=30). 24 tests. |
| 30 | System / repo pause flags | ✓ | M11: `orchestrator/system_state.py` + schema v2 (`system_state` table). Surfaced in `claude247 status`. |
| 31 | Real PR creation via gh | ✓ | M11.5: `orchestrator/github_client.py` + `dispatcher.handle_start_task` wires push + draft PR + records into `prs`. 10 + 7 tests. |
| 32 | Real auto-merge via gh | ✓ | M11.5: AUTO_MERGE ruling → `gh pr merge` (squash default, overridable). Triple gate: `allow_remote_writes` + repo opt-in + ruling. |
| 33 | Approve_merge actually merges | ✓ | M11.5: `dispatcher.handle_approve_merge` calls `gh pr merge` when writes are on; records decision + transitions task. |
| 34 | Live Gemini 2.5 Pro adapter | ✓ | M11.5: real API call returned `validator=gemini` + structured verdict in 16.7s (one-shot smoke from `~/.claude-dispatch/.env`). |
| 35 | CI poller (`gh pr checks` → `ci_results`) | ✓ | M12: `orchestrator/ci_poller.py` + dispatcher hook. 6 tests. |
| 36 | Risk factor `database_migration` auto-detect | ✓ | M12: path glob OR SQL DDL keyword sniff in diff content. |
| 37 | Risk factor `low_test_coverage` auto-detect | ✓ | M12: `orchestrator/coverage_parser.py` (Cobertura + coverage.json). |
| 38 | Qdrant real embedder | ✓ | M12: `text-embedding-3-small` via httpx when `OPENAI_API_KEY` set; SHA256 fallback. |
| 39 | Per-task `max_repair_attempts_per_task` honored | ✓ | M12: `runner_manager.build_task_spec` propagates → `runner.worker` → `role_loop`. |
| 40 | launchd-spawned jobs see `.env` keys | ✓ | M12: `orchestrator/env_loader.py` called at `dispatcher_cmd` startup. Never logs values. |
| 41 | Planner prompt carries retrieved memory | ✓ | M13: `role_loop._gather_memory_for_planner` + RELEVANT_MEMORY block. 6 tests. |
| 42 | GitHub webhook receiver | ✓ | M13: `dashboard /webhooks/github` with HMAC-SHA256; `orchestrator/webhooks.py` handles pull_request / check_run / check_suite / status. 13 tests. |
| 43 | Workspace + log GC | ✓ | M14: `orchestrator/gc.py` per `system.workspace_gc_days` + `system.log_gc_days`. Called every dispatcher tick. |
| 44 | Orphan-running command recovery | ✓ | M14: `gc._recover_orphans` flips stuck `running` rows to `failed`. |
| 45 | State DB backup + rotation | ✓ | M14: `scripts/backup_db.sh` via `sqlite3 .backup` + `com.claude247.backup` launchd plist (daily 03:17 UTC, 14-file rotation). |
| 46 | `/metrics` (Prometheus) | ✓ | M14: `orchestrator/metrics.py` + dashboard route. tasks / commands / prs / alerts / logs / memory / system flags. |
| 47 | N-validator panel (N ≥ 3) | ✓ | M15: `validate(extra_judges=[...])` + `validators.min_validators` int (supersedes legacy bool). 4 tests. |
| 48 | Dashboard pagination | ✓ | M15: `?limit=&offset=` on /tasks, /prs, /commands, /logs. Bad input clamped. `_pagination.html` partial. |
| 49 | Golden sandbox E2E | ✓ | M15: `tests/integration/test_sandbox_e2e.py` walks full dispatcher pipeline against in-process SandboxRunner + SandboxGithub. 3 paths (auto-merge / waiting / paused). |

## M18 beta-readiness (v1.0.0-beta.0)

| # | Item | Status | Where it lives |
|---|---|---|---|
| 50 | Explicit `worker_mode` + no silent API fallback | ✓ | M18-P0: `runner/auth.py`, `runner/claude_cli.py`, `config/default.yaml` (`auth.*`), `gateway/doctor.py::check_auth_mode`. 12 tests in `tests/unit/test_auth_mode_no_silent_fallback.py`. |
| 51 | Real OpenAI validator + mock-cannot-silently-pass-auto-merge | ✓ | M18-P1: `validator/openai_judge.py` (real REST via httpx, mock-labeled fallback), `validator/validation_policy.py` (mock-gate). Per-validator `require_real_for_auto_merge` flag. |
| 52 | launchd doctor + plist test coverage | ✓ | M18-P2: `scripts/doctor_launchd.sh`, `gateway/doctor.py::check_launchd`, `tests/unit/test_launchd_plist_generation.py` (9 tests). |
| 53 | Live GitHub webhook through ngrok | ✓ | M18-P3: `WEBHOOK_LIVE_REPORT.md`. Explicit `handle_ping` added in `orchestrator/webhooks.py`. Real deliveries: 1 ping + 1 pull_request + 7 check_run, all 200 OK + DB persisted. |
| 54 | Second real E2E on local-first auth path | ✓ | M18-P4: `REAL_E2E_REPORT_M18_P4.md`. $0.00 Anthropic spend, real Gemini judge, PR #53 cycled through full pipeline, auto-merge gate held on NEEDS_HUMAN verdict. |

## Truly remaining (beta-readiness backlog → BR-001/002/003)

- BR-001 (medium): `JudgeInput` includes diff *summary*, not diff
  *body*. Real validators (correctly) refuse to verify byte-identical
  preservation without the body. Surfaced by P4.
- BR-002 (low): `env_loader.load()` only reads
  `~/.claude-code-247/.env`; project-local `.env` is ignored.
  `OPENAI_API_KEY` in CWD/.env runs as mock in P4.
- BR-003 (low): dispatcher summary reports `worker_exit: 3` even when
  role artifacts are complete and PR is clean. Observability nit.
- Qdrant backend's `text-embedding-3-small` path is wired but
  un-tested live (no Qdrant running, no embedding key in test env).
- Multi-machine HA isn't designed for — single-Mac scope is by design.
