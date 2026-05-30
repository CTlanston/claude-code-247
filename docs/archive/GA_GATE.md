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

**Allowed status values:** `PASS` · `PARTIAL` · `FAIL` · `WAIVED_BY_OWNER`.

`WAIVED_BY_OWNER` means the owner accepted publication without a full
PASS for this gate. It must be paired with an explicit caveat and a
follow-up item. It is **not** a `PASS`.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | 24h soak PASS — launchd services stay healthy, dispatcher doesn't crash-loop, no orphan running commands, no alert storm | ⚠️ **WAIVED_BY_OWNER** at v1.0.0 release | See `## GA decision: v1.0.0 owner waiver` below. ~9h12m healthy soak observed (4/4 launchd loaded, ~1182 dispatcher idle ticks, backup completed and dispatcher continued, 0 alerts, 0 orphan commands, $0 Anthropic worker spend). Full 24h wall-clock duration **not** completed at release time. Follow-up: record final T+24h result after wall-clock crosses `2026-05-25T21:46Z`. |
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
| 19 | Docs current (README + docs/ + DoD + CHANGELOG) | ✅ PASS at v1.0.0 release | README, CHANGELOG, DEFINITION_OF_DONE, GA_GATE, M20_SOAK_RESULT, M22_GA_DECISION_REPORT, RELEASE_NOTES_GA all updated in the v1.0.0 release commit. Watchdog dashboard documented in README. |

**Status at v1.0.0 release: 18 / 19 PASS + 1 WAIVED_BY_OWNER (gate #1).**

Prior to the M22b owner waiver: 17 / 19 PASS, 2 outstanding. The
waiver closes the outstanding wallclock gate; the docs refresh
closes the other.

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
4. **Owner waivers must be explicit, named, dated, and paired with a
   follow-up.** `WAIVED_BY_OWNER` is never silent and never claims
   the gate passed. The original criterion remains visible.

## GA decision: v1.0.0 owner waiver (2026-05-25)

The owner explicitly approved the early `v1.0.0` release with a soak
waiver after **~9h 12m of healthy soak evidence**, instead of
waiting for the full 24h wall-clock window the gate originally
required.

Observed soak evidence at decision time:

| Probe | Value |
|---|---|
| Elapsed since T0 (dispatcher reload `2026-05-24T21:46Z`) | ~9h 12m |
| 24h target progress | ~38.4% |
| launchd services loaded | 4 / 4 |
| Dashboard `/healthz` | OK |
| Dispatcher healthy idle ticks (30s interval) | ~1182 |
| Backup job (daily, local hour 03) | Completed successfully; dispatcher continued working afterward |
| Active tasks | 0 |
| Stuck tasks | 0 |
| Orphan running commands | 0 |
| New alerts since T0 | 0 |
| Structured log errors since T0 | 0 |
| Anthropic worker spend since T0 | $0.0000 |

Known yellow flag (recorded, not waived):

- One early SQLite schema-migration race at **T0 + 7 minutes**:
  `dispatcher.err.log` recorded one `sqlite3.OperationalError: no
  such column: started_at` traceback. The file stopped growing at
  that timestamp; the subsequent ~1182 dispatcher ticks succeeded;
  the error did not repeat. Most plausible cause: schema.sql
  referenced the M21-P2 phase columns before the in-place ALTER
  TABLE migration finished on that particular tick.

Required follow-up (non-blocking, but committed):

- Record the final T+24h soak result after `2026-05-25T21:46Z`
  wall-clock passes. File the result in `M22c_SOAK_FINAL.md`.
- If the final observation shows any failure mode that 9h could
  not catch, open a post-GA hotfix.

The waiver is **explicit**, **named** (owner decision via the M22b
directive), **dated** (2026-05-25), and **paired with a
follow-up** (final T+24h observation). Per hard rule #4, it is
**not** a `PASS`.

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
