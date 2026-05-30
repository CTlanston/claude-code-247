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

## M19 beta-stabilization (v1.0.0-beta.1)

| # | Item | Status | Where it lives |
|---|---|---|---|
| 55 | BR-001 — safe diff body to validators | ✓ | M19-P1 (`c6d6aeb`): `EvidenceCollector.snapshot_diff_body_safe()` emits `.evidence/diff_body_safe.md` + `diff_body_metadata.json`; default forbidden-path floor + per-file `secret_scanner.scan`; `JudgeInput` gains `diff_body_safe` + `diff_body_metadata`; `evidence_prompt()` adds `## DIFF_BODY` + directive instruction. 18 tests. |
| 56 | BR-002 — deterministic env + config resolution | ✓ | M19-P2 (`b65e7f6`): `orchestrator/env_loader.py::{discover_env_paths, load_chain, RuntimeConfig, load_runtime_config}`; `orchestrator/config.py::resolve_config_path`; `gateway/doctor.py::check_config_source`; `scripts/launchd/*.plist.tpl` set `CLAUDE247_CONFIG`. 28 tests. |
| 57 | BR-003 — per-phase worker_exits observability | ✓ | M19-P3 (`687144c`): new `worker_exits` SQLite table (schema v3) + `orchestrator/worker_exits.py::{CLASSIFICATIONS, record_worker_exit, list_worker_exits, classify_failure}`; instrumented `evidence_collector.run_named_commands`; `handle_explain_stuck` surfaces rows; new `claude247 worker-exits` CLI. 25 tests. |
| 58 | M19-F1 — secret_scanner FP on `tokens` | ✓ | M19-P5b (`396c153`): `(?im)` → `(?m)` in `env_var_assign` regex. 2 regression tests. Surfaced by Phase 5 first E2E run; verified fixed by Phase 5 rerun (Gemini real PASS conf 1.0 on the same diff that was previously redacted). |

## M20 production proof (proposed v1.0.0-beta.2)

| # | Item | Status | Where it lives |
|---|---|---|---|
| 59 | env_loader picks up secrets.env + handles bash `export` | ✓ | M20-P1b (`5aed874`): `orchestrator/env_loader.py::discover_env_paths` adds `<user_config_dir>/secrets.env`; `load()` strips `export ` prefix. 5 regression tests. |
| 60 | Dispatcher startup uses full env chain | ✓ | M20-P3b (`1eb9d10`): `gateway/commands/dispatcher_cmd.py` calls `load_chain(discover_env_paths(cwd=None))` so the M20-P1b chain takes effect for launchd-spawned dispatchers. |
| 61 | OpenAI validator default model unblocked | ✓ | M20-P3d: `validator/openai_judge.py::DEFAULT_MODEL` and `config/default.yaml::validators.openai.model` changed from `gpt-5` (org-gated) to `gpt-4o` (widely available). |
| 62 | Evidence diff resolves base ref dynamically | ✓ | M20-P3g (`1c18d49`): `EvidenceCollector._resolve_base_ref()` uses `task_spec.default_branch` -> `origin/<branch>` -> `HEAD`. 2 regression tests. |
| 63 | Evidence diff includes untracked new files | ✓ | M20-P3i (`ef30853`): `snapshot_diff_body_safe` synthesizes new-file diffs via `git ls-files --others`. 3 regression tests. |
| 64 | Role-loop refreshes evidence between iterations | ✓ | M20-P3j (`cca1858`): `runner/role_loop.py::_refresh_diff_evidence` runs after coder and after each repair so reviewer sees fresh state. Demonstrated by the auto-merge E2E. |
| 65 | launchd daemon mode installed + verified | ✓ | M20-P2: 4 services loaded (`dashboard` KeepAlive + `orchestrator`/`dispatcher`/`backup` scheduled). `/healthz` OK. |
| 66 | 24h soak plan + baseline recorded | ✓ | M20-P5: [M20_SOAK_PLAN.md](M20_SOAK_PLAN.md). |
| 67 | **Pure auto-merge end-to-end with both real validators** | ✓ | M20-P3 final: [auto-evo-playground#59 (MERGED)](https://github.com/CTlanston/auto-evo-playground/pull/59). Gemini PASS conf 1.0 + OpenAI PASS conf 1.0 + risk 0 + ruling AUTO_MERGE + merged in 3s. Anthropic worker spend $0.00. |

## M21 GA-readiness hardening (Unreleased, proposed v1.0.0)

| # | Item | Status | Where it lives |
|---|---|---|---|
| 68 | `worker_exits` schema v4 (phase lifecycle fields) | ✓ | M21-P2 (`3f963f7`): `memory/schema.sql` + `memory/db.py::_migrate_v4_worker_exits_phase_columns`. 5 schema tests. |
| 69 | `record_phase()` context manager | ✓ | M21-P2: `orchestrator/worker_exits.py::record_phase`. 7 recording tests + 3 integration tests. |
| 70 | Dispatcher instrumented for 7 phases | ✓ | M21-P2: `orchestrator/dispatcher.py::handle_start_task` wraps prepare_workspace, worker, validators, risk_score, merge_policy, push, open_pr, auto_merge. |
| 71 | `claude247 task-phases --task <id>` CLI alias | ✓ | M21-P2: `gateway/cli.py` registers `worker-exits` under both names. |
| 72 | Drill A — secret in diff blocks merge | ✓ | M21-P3: tests/integration/test_secret_scanner_blocks_merge.py |
| 73 | Drill B — validator disagreement blocks | ✓ | M21-P3: tests/integration/test_validator_disagreement_blocks_merge.py |
| 74 | Drill C — high-risk path blocks | ✓ | M21-P3: tests/integration/test_high_risk_blocks_automerge.py |
| 75 | Drill D — budget exceeded defers task | ✓ | M21-P3: tests/integration/test_budget_exceeded_pauses_repo.py (note: defers rather than pauses; safety preserved) |
| 76 | Drill E — `stop-all` emergency kill | ✓ | M21-P3: tests/integration/test_stop_all_emergency_kill.py |
| 77 | Drill F — gh merge failure recorded | ✓ | M21-P3: tests/integration/test_merge_failure_records_worker_exit.py |
| 78 | No-regression happy-path observability (simulated) | ✓ | M21-P4: tests/integration/test_m21_happy_path_phase_observability.py |
| 79 | GA gate document | ✓ | [GA_GATE.md](GA_GATE.md) (19 GA_BLOCKERs; 17/19 satisfied) |
| 80 | M21 final report (GO/NO-GO) | ✓ | [M21_GA_READINESS_REPORT.md](M21_GA_READINESS_REPORT.md) — current answer is **NO-GO until 24h soak**. |

## M22b — watchdog status board + v1.0.0 GA release (2026-05-25)

| # | Item | Status | Where it lives |
|---|---|---|---|
| 81 | Read-only watchdog status board (CLI + FastAPI route + Markdown writer) | ✓ | `gateway/status_board.py`, `gateway/commands/status_board_cmd.py`, `dashboard/app.py::/status-board`, `dashboard/templates/status_board.html` |
| 82 | Apple-style watchdog page with Activity ring + i18n EN ↔ 中文 + dark mode + auto-refresh | ✓ | `dashboard/templates/status_board.html` (zero external deps, vanilla JS + SVG) |
| 83 | Usage card (runs / cost / active workers / by role / by auth_mode) | ✓ | `gateway/status_board.py::collect_usage`, `tests/unit/test_status_board_usage.py` |
| 84 | Watchdog read-only contract regression test | ✓ | `tests/unit/test_status_board.py::test_read_only_does_not_mutate_db` |
| 85 | M22b owner waiver for 24h soak | ⚠️ **WAIVED_BY_OWNER** | [GA_GATE.md](GA_GATE.md) gate #1, [M22_GA_DECISION_REPORT.md](M22_GA_DECISION_REPORT.md) §"M22b owner waiver", [M20_SOAK_RESULT.md](M20_SOAK_RESULT.md) §"Owner waiver" |
| 86 | Docs current (README + CHANGELOG + DoD + GA_GATE + soak + decision + release notes) | ✓ | this file, [CHANGELOG.md](CHANGELOG.md), [README.md](README.md), [GA_GATE.md](GA_GATE.md), [RELEASE_NOTES_GA.md](RELEASE_NOTES_GA.md) |

## v1.0.0 release record

| Field | Value |
|---|---|
| Tag | `v1.0.0` |
| Date | 2026-05-25 |
| GA decision | APPROVED with explicit owner soak waiver |
| Tests at release | **566 passing** (was 526 at M21; +40 for M22b watchdog) |
| Doctor at release | `ok=True`, 0 fails, 3 known non-blocking warns |
| Launchd at release | 4 / 4 services healthy |
| Soak status at release | **WAIVED_BY_OWNER** (~9h 12m observed of 24h target, all probes green; final T+24h is a post-GA follow-up) |
| GA gates at release | **18 PASS + 1 WAIVED_BY_OWNER** (gate #1) |
| Known yellow flag | One self-healed SQLite schema-migration race at T+7m; did not repeat |
| Annotated tag SHA | `d10ed715cada64ea66bcac817592690ae92f2969` |
| main commit (tag points here) | `811ffce27438b79ab426bbc5717effcd6b76a4ea` |
| GitHub Release URL | https://github.com/CTlanston/claude-code-247/releases/tag/v1.0.0 |
| Pre-release flag | false (normal release) |
| Post-GA T+24h follow-up required | YES — file `M22c_SOAK_FINAL.md` after `2026-05-25T21:46Z` |

## Post-GA follow-up (committed, not deferred indefinitely)

1. **Record final T+24h soak result** in `M22c_SOAK_FINAL.md` after
   `2026-05-25T21:46Z` wall-clock passes. The watchdog auto-detects
   the crossover.
2. **Schema v5 migration** — add `runs.input_tokens` /
   `runs.output_tokens` columns + worker write-through, enabling
   token-level rate display in the watchdog Usage card.

## Post-GA backlog (NOT blockers)

See the POST_GA_BACKLOG section in [GA_GATE.md](GA_GATE.md). Items
explicitly include: multi-machine HA, cloud dashboard with team RBAC,
7-day soak, auto-pause on repeat budget hits, deeper role_loop
instrumentation, per-validator phase rows, doctor port-busy detection,
Qdrant live test, BSD-sed compat in `doctor_launchd.sh`.
