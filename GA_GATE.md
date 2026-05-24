# v1.0.0 GA Gate

The criteria below classify what blocks a `v1.0.0` GA tag, what is
required-but-may-still-be-imperfect, and what is explicitly deferred
to post-GA work. The system at `v1.0.0-beta.2` (commit `560227e`,
2026-05-24) meets most GA_BLOCKER items; the open one is the 24h soak
result.

This document is the contract: **do not tag `v1.0.0` unless every
GA_BLOCKER is satisfied.**

---

## GA_BLOCKER — must be true before tagging

Each row points at the canonical evidence file or test.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | 24h soak PASS — launchd services stay healthy, dispatcher doesn't crash-loop, no orphan running commands, no alert storm | ⏳ **PARTIAL** (baseline only) | [M20_SOAK_RESULT.md](M20_SOAK_RESULT.md); needs 24h wallclock to complete |
| 2 | `pytest -q` full PASS | ✅ 526 passing | latest commit |
| 3 | `claude247 doctor` returns OK (only known non-blocking warnings) | ✅ | [M21_GA_READINESS_REPORT.md](M21_GA_READINESS_REPORT.md) §Phase 0 |
| 4 | launchd 4 services loaded + healthy | ✅ | M21_GA_READINESS_REPORT.md §Phase 0 |
| 5 | Dashboard reachable on 127.0.0.1:8423 | ✅ | M21_GA_READINESS_REPORT.md §Phase 0 (`{"ok":true}`) |
| 6 | Worker uses local Claude Code mode (M18-P0 invariant) | ✅ | M20 PR #59 (`auth_mode=local_claude_code`) |
| 7 | Anthropic API spend = $0 on real live task | ✅ | M20 PR #59 ($0.00) |
| 8 | Gemini real validator works | ✅ | M20 PR #59 (PASS conf 1.0) |
| 9 | OpenAI real validator works (`gpt-4o` or operator-configured) | ✅ | M20 PR #59 (PASS conf 1.0) |
| 10 | Low-risk auto-merge works on a real repo | ✅ | [auto-evo-playground#59 (MERGED)](https://github.com/CTlanston/auto-evo-playground/pull/59) |
| 11 | Secret scanner blocks merge | ✅ | tests/integration/test_secret_scanner_blocks_merge.py |
| 12 | Validator disagreement blocks auto-merge | ✅ | tests/integration/test_validator_disagreement_blocks_merge.py |
| 13 | High-risk path (forbidden_path) blocks merge | ✅ | tests/integration/test_high_risk_blocks_automerge.py |
| 14 | `claude247 stop-all` actually stops + pauses system | ✅ | tests/integration/test_stop_all_emergency_kill.py |
| 15 | Failure-replay works (`claude247 replay`) | ✅ | tests/unit/test_replay_manager.py + tests/unit/test_cli_replay.py |
| 16 | Logs searchable (`claude247 logs search`) | ✅ | tests/unit/test_log_indexer.py |
| 17 | Phase observability — every dispatched phase writes a worker_exits row with status/started_at/finished_at | ✅ | tests/integration/test_m21_happy_path_phase_observability.py |
| 18 | gh merge failure surfaces phase exit (no silent failure) | ✅ | tests/integration/test_merge_failure_records_worker_exit.py |
| 19 | Docs current (README + docs/ + DoD + CHANGELOG) | ⏳ partial — README hasn't been refreshed for M20/M21; will close in P6 |

**Status: 17/19 GA_BLOCKERs satisfied as of 2026-05-24 22:00 UTC.**
Outstanding: (1) 24h soak, (19) README refresh. Neither requires more
code; both are wallclock + writing.

---

## GA_REQUIRED — should be true; may be imperfect

These are quality bars rather than safety gates. A `v1.0.0` can ship
with one or two of these being "good enough, with a known wart" but
should not ship missing them entirely.

| Criterion | Status |
|---|---|
| `doctor` covers every required runtime dependency | ✅ |
| `claude247 status --plain` is mobile-readable | ✅ |
| Worker auth mode reported honestly (M18-P0) | ✅ |
| Mock validators cannot silently auto-merge (M18-P1) | ✅ |
| `env_loader` resolves config + secrets deterministically (BR-002 + M20-P1b) | ✅ |
| `diff_body_safe.md` produced and surfaced to validators (BR-001) | ✅ |
| Per-phase observability for explain-stuck (BR-003 + M21-P2) | ✅ |
| 7 instrumented phases each carry useful metadata | ✅ |
| `claude247 task-phases --task <id>` output is debug-friendly | ✅ |
| launchd plists include `CLAUDE247_CONFIG`, `HOME`, `PATH` | ✅ |
| Budget cap prevents runaway worker loops | ✅ (drill D) |
| `secrets.env` loaded automatically (no manual `with-secrets` wrapper needed) | ✅ (M20-P1b) |
| Webhook receiver verified live (M18-P3) | ✅ |
| Live PR end-to-end with $0 Anthropic spend | ✅ M20 PR #59 |

---

## POST_GA_BACKLOG — explicit non-blockers

These items have been raised at various points but are **not** GA
blockers. Filed here so they don't accidentally get promoted to
blocker via informal scope creep.

- Multi-machine HA (single-Mac is by design)
- Cloud-hosted dashboard with team RBAC (local-first is by design)
- 7-day soak observation (24h is the GA gate; 7d is post-GA hardening)
- Auto-escalation of budget exceedance to `system_state.pause_repo`
  (currently defers the specific command; safety preserved either way)
- Deeper `worker_exits` instrumentation for planner / coder / repair
  inside role_loop (M21-P2 covered the dispatcher-level phases; the
  role_loop-internal ones are observable through worker_done.md and
  validator_results)
- Per-validator phase rows (`validator_gemini`, `validator_openai`)
  rather than the composite `validators` phase — per-validator detail
  already lives in `validator_results` table
- `doctor` should detect "the dashboard busy on port 8423 is OUR own
  daemon" rather than warning
- `doctor`'s validator-key check should use `load_runtime_config()`
  instead of bare `os.environ` so it reflects what the dispatcher
  actually sees
- More advanced analytics (cost trends, per-repo PR throughput)
- Qdrant live test with a real embedding key
- `scripts/doctor_launchd.sh` BSD-sed compatibility fix

---

## Hard rules

1. **No GA_BLOCKER item moves to POST_GA_BACKLOG without an explicit
   user decision.** If a check is hard, the answer is to fix it,
   not to recategorize it.
2. **The 24h soak runs uninterrupted.** Restarting the dispatcher for
   ad-hoc work resets the soak clock. Any future operator change to
   launchd during the soak window invalidates the result; restart the
   soak from a new T0.
3. **The GA tag is created on `main` only**, after a fast-forward
   from `claude247/v1`. No tag may point to a non-main commit.

---

## What happens after GA_BLOCKER is fully green

1. The operator confirms M21_GA_READINESS_REPORT.md says GO.
2. The operator explicitly authorizes `v1.0.0` tag creation.
3. The release runs through the same script as `beta.0/1/2`:
   - `git checkout main && git merge --ff-only claude247/v1`
   - `git tag -a v1.0.0 -m "..." && git push origin main v1.0.0`
   - `gh release create v1.0.0 --notes-file RELEASE_NOTES_GA.md`
4. The CHANGELOG.md `[Unreleased]` block becomes the `[v1.0.0]`
   block and a new `[Unreleased]` placeholder is added.

`v1.0.0` is not the end of work — it's the moment the project
becomes "ready for someone other than the author to rely on it
without re-reading the code first."
