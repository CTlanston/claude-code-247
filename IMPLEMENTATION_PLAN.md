# IMPLEMENTATION_PLAN.md

> Transform `claude-code-247` into a production-grade, local-first, multi-repo,
> 24/7 autonomous coding coworker. Source spec: the design doc handed to
> Claude Code at session start (30 sections, 10 milestones).

## 0. Where we are

The repo currently runs **two layers** built around a single GitHub test repo
(`CTlanston/auto-evo-playground`):

| Layer | Lives in | Status |
|---|---|---|
| **Auto-Evo inner engine** (4 roles + shadow CI) | `orchestrator/`, `runner/` | working end-to-end |
| **AutoDev v3 outer loop** (supervisor + state machine + cost policy + hold) | `autodev/`, `scripts/autodev_*.sh`, `reports/`, `tasks/`, `commands/` | mission-complete at L5 (cycle-50) |

The new product is a different shape: multi-repo, local-first, mobile-driven,
Docker-runner-based, with external validators and risk-scored auto-merge.

Toolchain on this Mac (verified): Docker 29.4.2, gh 2.91, Claude Code 2.1.142,
Python 3.13, sqlite3 3.51, Docker Compose v5. Available services per owner:
Docker running, ≥1 of {Gemini,OpenAI} key, ntfy.sh ready.

## 1. Architecture decisions (locked at session start)

1. **Replace** the existing `orchestrator/` and `runner/` rather than wrap them.
   Auto-Evo + AutoDev v3 move under `archive/auto-evo/` for reference.
2. **The new spec fully overrides** the old `CLAUDE.md` non-negotiables
   forbidding `git push` and auto-merge. New `CLAUDE.md` keeps secret-hygiene
   and approval rules but allows push/merge for repos with `enabled: true`
   in the registry and `system.allow_remote_writes: true` in config.
3. **Push through all 10 milestones autonomously**; only stop on hard
   blockers, then write `BLOCKERS.md` per spec §29.
4. **Real external services where keys are present**, mock adapters where
   they're absent. The adapter interface is identical either way so swap
   is one config flip.

## 2. Module map (target vs current)

| Spec module | Current state | Plan |
|---|---|---|
| `orchestrator/main.py` | Auto-Evo, 35K | Archive, rewrite minimal entry that wires scheduler + queue |
| `orchestrator/scheduler.py` | Auto-Evo style | Archive, rewrite — wakes loop, picks tasks per repo budgets |
| `orchestrator/task_manager.py` | — | Create — owns task lifecycle transitions + task_events log |
| `orchestrator/repo_registry.py` | — | Create — `~/.claude-code-247/repos.yaml` parser + SQLite mirror |
| `orchestrator/command_queue.py` | parts in `autodev/command_manager.py` | Create — SQLite-backed FIFO with statuses |
| `orchestrator/runner_manager.py` | — | Create — spawns/monitors Docker workers |
| `orchestrator/merge_policy.py` | — | Create — gates auto-merge |
| `orchestrator/risk_score.py` | — | Create — 0-100 scoring |
| `orchestrator/budget_manager.py` | parts in `autodev/cost_policy.py` | Create |
| `orchestrator/notification_manager.py` | — | Create — ntfy.sh + local log |
| `orchestrator/memory_manager.py` | — | Create — orchestrator-side memory access |
| `orchestrator/replay_manager.py` | — | Create |
| `orchestrator/log_indexer.py` | — | Create — SQLite logs table + FTS |
| `orchestrator/alert_deduper.py` | — | Create — fingerprint window |
| `gateway/cli.py` | — | Create — `claude247` entry point |
| `gateway/commands.py` | — | Create — subcommand implementations |
| `gateway/remote_bridge.py` | — | Create — output formatters for Remote/Dispatch |
| `dashboard/app.py` | — | Create — FastAPI + HTMX |
| `dashboard/routes/`, `templates/`, `static/` | — | Create |
| `runner/Dockerfile` | exists | Rewrite — Python 3.13 + claude CLI + git + gh |
| `runner/entrypoint.sh` | exists | Rewrite |
| `runner/worker.py` | — | Create — driver inside container |
| `runner/prompt_builder.py` | — | Create |
| `runner/evidence_collector.py` | — | Create |
| `validator/judge_contract.py` | — | Create |
| `validator/gemini_judge.py` | — | Create |
| `validator/openai_judge.py` | — | Create |
| `validator/validation_policy.py` | — | Create |
| `memory/schema.sql` | — | Create — full SQLite schema |
| `memory/vector_store.py` | — | Create — Qdrant + SQLite-FTS fallback |
| `memory/compiler.py` | — | Create — daily/weekly digest |
| `memory/repo_memory.py` | — | Create — `.agent/*.md` reader/writer |
| `config/default.yaml`, `policies.yaml` | — | Create |
| `scripts/install_launchd.sh` | partial (`install_launchd_autodev.sh`) | Rewrite for new daemons |
| `scripts/uninstall_launchd.sh` | — | Create |
| `scripts/smoke_test.sh` | — | Create |
| `scripts/doctor.sh` | partial (`autodev_doctor.sh`) | Rewrite, called by `claude247 doctor` |
| `tests/unit/`, `tests/integration/` | mixed under `tests/` | Reorganize |

## 3. Files to ARCHIVE in M0

Move to `archive/auto-evo/` and remove from the active path:

- `orchestrator/` (all 24 files) → `archive/auto-evo/orchestrator/`
- `runner/` (all 3 files) → `archive/auto-evo/runner/`
- `autodev/` (all 14 files) → `archive/auto-evo/autodev/`
- `scripts/autodev_*.sh`, `scripts/install_launchd_*.sh`, `scripts/*p5*.sh`,
  `scripts/*_dashboard.sh`, `scripts/*self_repair*.sh`, `scripts/*continuous*.sh`,
  `scripts/autodev_*` → `archive/auto-evo/scripts/`
- All `AUTODEV_*.md`, `IMPLEMENTATION_PROMPT*.md`, `ARCHITECTURE.md`, `ROADMAP.md`,
  `BACKLOG.md`, `CHANGELOG.md`, `CONTEXT.md`, `DEFERRED.md`, `FAILURES.md`,
  `HUMAN_CONFIG*.md`, `LEVEL.md`, `RUN_NOTES.md`, `STATE.md`, `ONBOARDING.md`,
  `migrate_out_of_desktop.sh` → `archive/auto-evo/docs/`
- `cycles/` → keep as-is (frozen historical state, doesn't interfere)
- `reports/` → keep as-is (historical), but new code writes to `~/.claude-code-247/state/`
- `tests/` Auto-Evo specific → `archive/auto-evo/tests/` (the new repo will
  have a fresh `tests/` tree)
- Old `docker-compose.yml` → `archive/auto-evo/docker-compose.yml`; new
  `docker-compose.yml` at root for new services.
- `.claude/agents/`, `.claude/hooks/`, `.claude/skills/` — these are
  Claude Code session helpers; **keep** since they're useful for the
  agent driving v1 dev.

## 4. Files to CREATE in M0 (skeleton)

- `IMPLEMENTATION_PLAN.md` (this file)
- new `CLAUDE.md` (project-level policy for v1)
- new `README.md` (replaces old one; old one moves to archive)
- new `docker-compose.yml`
- `pyproject.toml`
- placeholder `claude247/__init__.py` and the package layout per §2.1

## 5. Test strategy

- Unit tests live in `tests/unit/<module>/test_*.py`.
- Integration tests in `tests/integration/`. Mark slow ones with
  `@pytest.mark.slow` and skip by default.
- External-service tests (Gemini, OpenAI, ntfy, real Docker pull) are
  skipped unless env vars / `--integration` flag set.
- Each milestone commit must keep `pytest tests/unit` green.

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Breaking the running launchd-managed AutoDev v3 worker | New install scripts use different label `com.claude247.*`; old `com.autodev.*` plist is left alone. Owner can uninstall manually later. |
| Python 3.13 vs 3.9 split | `pyproject.toml` declares `>=3.10`. Local Python 3.13 used for venv and tests. CI (if added later) pins 3.12. |
| `claude -p` not callable from inside Docker without auth | Runner is **launched by the orchestrator on the host**, not from inside the orchestrator container; it bind-mounts the host's `~/.claude/` so local auth carries through. This is the practical price of "local Claude Code preferred". Documented in M4 + `docs/SECURITY.md`. |
| Disk thrash from `.evidence/` files per task | Workspaces under `~/.claude-code-247/workspaces/<task_id>/`, GC'd after N days configurable. |
| Qdrant heavy / not installed | `memory/vector_store.py` has SQLite-FTS fallback; Qdrant is opt-in via `docker-compose --profile vector up`. |
| User accidentally runs auto-merge in production | Global `system.allow_remote_writes` defaults to `false`. Every push/merge code path goes through one gate function that checks it. |

## 7. First implementation batch (M0 + M1)

**M0 commits (one branch, multiple commits):**

1. `chore(v1): IMPLEMENTATION_PLAN.md`
2. `refactor(v1): archive Auto-Evo + AutoDev v3 under archive/auto-evo/`
3. `docs(v1): rewrite CLAUDE.md and README.md for the v1 product`

**M1 commits:**

4. `chore(v1): pyproject.toml + package skeleton + dev deps`
5. `feat(memory): SQLite schema + sqlite_store wrapper + migrations`
6. `feat(registry): repos.yaml schema + repo_registry.py + mirror to SQLite`
7. `feat(cli): claude247 entrypoint + status/repos/doctor commands`
8. `feat(doctor): environment checks + JSON output`
9. `feat(dashboard): FastAPI shell + /repos + /tasks stub`
10. `test(m1): unit + integration coverage for above; pytest green`

Subsequent milestones follow the same per-commit cadence. Each milestone ends
with a "✓ Milestone X done" commit that updates this plan and runs full tests.

## 8. Hard-blocker list

If any of the following happens, write `BLOCKERS.md` and stop:

- `docker` is not running and the user has set `runner: docker` (not `local`).
- `gh` not authenticated and a task hits the PR creation step (only blocks
  that task; we still proceed with other repos).
- `pip install` fails for required deps (`fastapi`, `sqlite`, `httpx`).
- Network completely unreachable AND validators are configured non-mock.

Anything else uses the per-task `HOLD` pattern: log it, notify, continue.

## 9. Done = all M10 acceptance criteria pass + smoke run

The exit criterion for this work session is: every checkbox in spec §28
("Definition of Done") is true OR has a documented mock with a green test.
