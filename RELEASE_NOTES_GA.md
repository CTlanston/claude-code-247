# v1.0.0 — Local-first 24/7 multi-repo Claude Code coworker

## Summary

This is the first GA release of `claude-code-247`.

It provides a local-first, multi-repo, 24/7 Claude Code coworker system using:

- local Claude Code worker mode (subscription auth, no Anthropic API key required)
- `launchd` daemon runtime (4 services: dashboard / orchestrator / dispatcher / backup)
- Docker-based worker execution
- GitHub as source-of-truth collaboration plane
- FastAPI + HTMX dashboard with a real-time **Apple-style watchdog page**
- CLI / Claude Remote-compatible command surface
- SQLite-backed state machine
- real Gemini 2.5 Pro validator
- real OpenAI-compatible validator
- risk scoring
- guarded auto-merge
- failure replay
- per-phase `worker_exits` instrumentation

## Production proof (already shipped in `v1.0.0-beta.2`)

`v1.0.0-beta.2` proved the pure auto-merge production path end-to-end on a
real GitHub repository ([auto-evo-playground#59](https://github.com/CTlanston/auto-evo-playground/pull/59)):

| Item | Value |
|---|---|
| Worker auth | `local_claude_code` (subscription) |
| Anthropic worker spend | **$0.00** |
| Gemini real validator | **PASS confidence 1.0** |
| OpenAI real validator (`gpt-4o`) | **PASS confidence 1.0** |
| Risk score | **0 (low)** |
| Merge ruling | **AUTO_MERGE** |
| Real PR auto-merged in | **3 seconds** (pr_created → merged) |

## M21 hardening (on top of beta.2)

- `worker_exits` schema v4 — phase lifecycle columns `status` /
  `started_at` / `finished_at` / `error_type` via additive migration
- dispatcher instrumentation for **7 phases** (`prepare_workspace`,
  `worker`, `validators`, `risk_score`, `merge_policy`, `push`,
  `open_pr`, `auto_merge`), each carrying phase-specific metadata
- `claude247 task-phases --task <id>` CLI alias
- **6 failure-mode integration drills**, all PASS:
  secret-in-diff blocks merge / validator disagreement blocks /
  high-risk path blocks / budget exceeded defers task /
  `stop-all` emergency kill / gh merge failure records phase exit
- 19-gate `GA_GATE.md` contract, with explicit `POST_GA_BACKLOG`
  so no safety check gets quietly demoted
- **526 → 566 tests passing** (added 40 tests for the M22b watchdog
  read-only status board)

## M22b — read-only watchdog status board

A new read-only watchdog dashboard added in M22b:

- `claude247 status-board` / `claude247 watchdog` CLI (plain / JSON /
  Markdown output)
- `/status-board` HTML page with **Apple-style Activity ring** for
  soak progress, auto-refresh every 15s (configurable), pause/resume,
  live indicator dot, **EN ↔ 中文** language toggle, dark mode
  auto-follow
- `/status-board.json` machine-readable endpoint
- Live aggregation of: release state, soak progress, launchd /
  dispatcher / dashboard / notifier / doctor health, queue + signals,
  GA gate status (parsed from `GA_GATE.md`), worker usage
  (runs / cost / active workers / by role / by auth_mode)
- **Strict read-only contract** — a regression test asserts that
  invoking the CLI does not change any row count in `tasks`,
  `commands`, `system_state`, `logs`, or `alerts`. Safe to run while
  the dispatcher is mid-tick.

## Explicit soak waiver

**The original 24h soak gate was NOT fully completed before this release.**

The owner explicitly waived the full 24h soak requirement after
**~9h+ of healthy soak evidence**, with all observable signals green:

| Signal | Observed |
|---|---|
| Elapsed soak at decision time | **~9h 12m / 24h (~38.4%)** |
| launchd services loaded | **4 / 4** |
| Dashboard `/healthz` | OK |
| Dispatcher healthy idle ticks | **~1182** (every 30s, all "idle: queue empty") |
| Backup job (daily 03 local) | **Completed** — `claude247-20260525T011703Z.db` (2.06 MB) created; dispatcher continued unaffected after |
| Active tasks | 0 |
| Stuck tasks | 0 |
| Orphan running commands | 0 |
| New alerts since T0 | 0 |
| Structured log errors since T0 | 0 |
| Anthropic worker spend since T0 | **$0.0000** |

### Known yellow flag

One early SQLite schema-migration race occurred at **T0 + 7 minutes**.
It was a one-time transient failure: `dispatcher.err.log` recorded a
single `sqlite3.OperationalError: no such column: started_at`
traceback (originating in `memory/db.py::init_db`), then the file
stopped growing. The subsequent ~1182 dispatcher ticks all succeeded.
The error did not repeat. Most plausible root cause: schema.sql
referenced the new M21-P2 columns before the in-place ALTER TABLE
migration finished on that particular tick.

### Post-GA follow-up (required)

- **Record the final T+24h soak result** after wall-clock crosses
  `2026-05-25T21:46Z` (the dispatcher T0 plus 24h). The watchdog
  dashboard auto-detects this and will flip `soak.result` from
  `PARTIAL` to `PASS` (or `FAIL`).
- File the result in a follow-up `M22c_SOAK_FINAL.md`.

## Safety model (unchanged from beta.2)

Auto-merge is guarded by, in order:

1. risk scoring (`orchestrator/risk_score.py`)
2. allowed / forbidden path policy
3. secret scanner (drill-tested: blocks merge if any match)
4. real Gemini validator
5. real OpenAI-compatible validator
6. validator-disagreement gate (drill-tested: routes to human)
7. high-risk block (drill-tested: never auto-merges)
8. failure replay (`claude247 replay`)
9. immutable command audit trail in `commands` table

The runtime safety gate `system.allow_remote_writes` defaults to
`false`. No `git push`, no PR merge, no GitHub write API call may
execute unless this flag is `true` AND the repo is `enabled: true`
in `repos.yaml`.

## Quick start

```bash
make install                                        # venv + deps + launchd plists
claude247 doctor
claude247 repo add                                  # CLI onboarding wizard
claude247 status-board --plain                      # read-only watchdog
open http://127.0.0.1:8423/status-board             # live watchdog page
claude247 start --repo my-repo --goal "refactor X"  # kick off a task
```

## Remaining post-GA backlog

These are explicit non-blockers, filed so they don't get promoted to
blocker via informal scope creep:

- Record final T+24h soak result (the carry-over from the waiver)
- Optional deeper multi-day soak observation (7-day, etc.)
- Schema v5 migration to add `runs.input_tokens` / `runs.output_tokens`
  columns + worker write-through, enabling token-level rate display in
  the watchdog dashboard
- More advanced dashboard analytics (cost trends, per-repo PR
  throughput)
- Multi-machine HA (single-Mac is by design)
- Cloud-hosted dashboard with team RBAC (local-first is by design)
- Qdrant live test with a real embedding key
- BSD-sed compatibility fix for `scripts/doctor_launchd.sh`
- `doctor` improvements:
  - detect "the dashboard busy on port 8423 is OUR own daemon"
    rather than warning
  - validator-key check should use `load_runtime_config()` instead of
    bare `os.environ` so it reflects what the dispatcher actually
    sees

## Pre-release lineage

| Tag | Date | Headline |
|---|---|---|
| `v1.0.0-alpha.0` | 2026-05-24 | v1 transformation complete |
| `v1.0.0-alpha.1` | 2026-05-24 | Real multi-repo E2E validation |
| `v1.0.0-beta.0` | 2026-05-24 | Beta-readiness milestone |
| `v1.0.0-beta.1` | 2026-05-24 | Beta stabilization |
| `v1.0.0-beta.2` | 2026-05-24 | Pure auto-merge production proof |
| **`v1.0.0`** | **2026-05-25** | **GA release with explicit owner soak waiver** |
