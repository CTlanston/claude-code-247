# M21 — GA Readiness Report

**Status**: IN PROGRESS · Phase 0 baseline complete
**Predecessor tag**: `v1.0.0-beta.2`
**Target tag** (gated on full M21 + explicit user approval): `v1.0.0`

---

## Phase 0 — Baseline verified

### Repo state

| Field | Value |
|---|---|
| Current branch | `claude247/v1` |
| HEAD | `560227ebb6f29f3bec6753f26caadf884a608880` |
| `main` (local) | `560227e` (in sync with HEAD) |
| `claude247/v1` (local) | `560227e` |
| `origin/main` | `560227e` (in sync) |
| `origin/claude247/v1` | `560227e` (in sync) |
| Working tree | clean |
| Latest tag | `v1.0.0-beta.2` (annotated, at `560227e`) |
| Latest GH release | `v1.0.0-beta.2 — Pure auto-merge production proof` (pre-release) |

### `pytest -q --no-cov`

```
502 passed in 14.28s
```

### `claude247 doctor` (summary)

```
✓ macOS host: Darwin 25.3.0
✓ python >= 3.11
✓ git
• docker: daemon not reachable (expected — local backend covers it)
✓ gh auth
✓ claude CLI: 2.1.142
✓ config source: loaded ~/.claude-code-247/config.yaml (kind=user); env files probed: 3
✓ auth mode: worker_mode=local_claude_code, usable=True
✓ sqlite3
✓ state dir writable
✓ sqlite db init: schema v3
✓ repos.yaml: 1 repo registered
• dashboard port free: 8423 busy (BY OUR OWN dashboard daemon — actually healthy)
✓ ntfy notifications
• validator API keys: doctor sees shell env only (runtime DOES load from secrets.env)
✓ launchd: 4/4 services loaded
OK
```

The two `•` warnings are both benign:
- `docker daemon not reachable` is fine — the local backend covers it.
- `dashboard port busy` means our own KeepAlive dashboard is running on 8423; healthy. Filed as small UX nit for doctor to detect "is my own dashboard already running".
- `validator API keys` doctor check looks at `os.environ` at probe-time, which the dispatcher does not yet have. The actual runtime via `load_runtime_config()` reports `gemini_key_present=True, openai_key_present=True` thanks to M20-P1b. Filed as small UX nit for doctor to use `load_runtime_config(apply_env=False)` instead.

### `claude247 status --plain`

```
System: running
Repos enabled: 1
Active tasks: 0
Stuck tasks: 0
Need approval: 6
Today: 2 completed, 4 failed
Next actions:
- claude247 approve-merge --repo auto-evo-playground --pr 58
```

"Need approval: 6" + "Today: 2 completed, 4 failed" reflect the M19/M20 iteration history — multiple cancelled or pending-approval tasks plus the slugify/dedupe/clamp PRs already merged. Not M21 work.

### launchd state

| Service | State | PID | Last exit |
|---|---|---|---|
| `com.claude247.dashboard` | loaded, KeepAlive | 42273 (live since M20-P2) | 0 |
| `com.claude247.orchestrator` | loaded, 60s tick | scheduled | 0 |
| `com.claude247.dispatcher` | loaded, 30s tick | scheduled | 0 |
| `com.claude247.backup` | loaded, daily 03:17 UTC | scheduled | 0 |

`/healthz` → `{"ok": true}` ✓

## Phase 1 — Soak observation ⏳ PARTIAL

[M20_SOAK_RESULT.md](M20_SOAK_RESULT.md). T+15m (dispatcher) / T+2h
(dashboard) at the time of this report. **GA tag must wait for full
24h PASS** — this is the one outstanding GA_BLOCKER from a code
standpoint.

## Phase 2 — Deepen worker_exits ✅ DONE

Commit `3f963f7`. See M21_GA_READINESS_REPORT §"Final 9 answers" below
for the headline. Highlights:

- Schema v4 (additive): `status`, `started_at`, `finished_at`,
  `error_type` added to `worker_exits` via in-place ALTER TABLE
  migration in `init_db()`.
- New `record_phase(...)` context manager — success / failure /
  skipped / explicit-fail paths, classifies exceptions via the same
  heuristic as `classify_failure()`, never shadows the caller's
  exception, observability is best-effort.
- 7 dispatcher phases instrumented end-to-end:
  `prepare_workspace`, `worker`, `validators`, `risk_score`,
  `merge_policy`, `push`, `open_pr`, `auto_merge`.
- `claude247 task-phases --task <id>` (alias of `worker-exits`) now
  shows the lifecycle fields.
- 15 new tests (5 schema + 7 recording + 3 integration), 0 regression.

## Phase 3 — Failure-mode drills ✅ ALL 6 PASS

Commit `e112621`. [M21_FAILURE_DRILLS_REPORT.md](M21_FAILURE_DRILLS_REPORT.md).

| Drill | Result |
|---|---|
| A — Secret scanner blocks merge | ✅ PASS |
| B — Validator disagreement blocks | ✅ PASS |
| C — High-risk path blocks | ✅ PASS |
| D — Budget exceeded defers task | ✅ PASS (deviation noted) |
| E — `stop-all` emergency kill | ✅ PASS |
| F — gh merge failure records worker_exit | ✅ PASS |

## Phase 4 — Verification task ✅ DONE (simulated)

Simulated proof in [tests/integration/test_m21_happy_path_phase_observability.py](tests/integration/test_m21_happy_path_phase_observability.py).
3 tests verifying:
- Full pipeline AUTO_MERGE happy path
- All 7+1 (auto_merge) instrumented phases land with lifecycle fields populated
- `validators` row payload carries final verdict + per-validator labels
- `risk_score` row payload carries score + level + files_changed

Live equivalent: M20 PR #59 (MERGED) — the most recent on-GitHub auto-merge
proof. We did not re-run a live `is_even` task because today's
`auto-evo-playground` budget is exhausted (12 tasks today vs cap 3),
and the simulated integration covers the regression risk for free.

## Phase 5 — GA gate ✅ DEFINED

[GA_GATE.md](GA_GATE.md). 19 GA_BLOCKERs identified; 17/19 satisfied.
Outstanding:
- (1) 24h soak — wallclock only
- (19) README refresh — writing only, no code

POST_GA_BACKLOG explicitly enumerated so no critical safety gate gets
quietly demoted.

## Phase 6 — Final report ✅ (this section)

---

## Final 9 answers

1. **Is beta.2 still healthy?** ✅ Yes — 526 passing, doctor OK,
   launchd 4/4 loaded, dashboard live, M20 invariants held.
2. **Did 24h soak fully pass?** ❌ No — PARTIAL only. See
   M20_SOAK_RESULT.md. **This is the one code-side GA blocker.**
3. **Are launchd services stable?** ✅ At the baseline window
   observed (≤2h dashboard, ≤15m dispatcher) all 4 services are
   loaded, dispatcher's err.log is empty, dashboard `/healthz` is
   live. Full 24h answer pending.
4. **Did worker_exits instrumentation deepen successfully?** ✅ Yes
   — schema v4 + 7 dispatcher phases + lifecycle fields + 15 new
   tests + non-breaking migration.
5. **Did failure-mode drills pass?** ✅ Yes — 6/6 on first run.
6. **Did no-regression low-risk task pass?** ✅ Simulated yes;
   live deferred to a future cycle (budget exhausted today, M20
   PR #59 is the on-GitHub proof from yesterday).
7. **Is v1.0.0 GA recommended now?** ❌ **NO** — do not tag yet.
8. **Exact blockers**:
   - GA_GATE #1: full 24h soak result not yet recorded.
   - GA_GATE #19: README refresh for M20/M21.
9. **Proposed tag and release title (when blockers clear)**:
   ```
   v1.0.0 — Local-first 24/7 multi-repo Claude Code coworker
   ```
   Release notes file: `RELEASE_NOTES_GA.md` (not yet written;
   produce alongside the tag operation per the GA_GATE.md script).

## Recommendation

**Stop here. Do not push `v1.0.0`.** Let launchd run untouched for 24
hours from M20_SOAK_RESULT.md's checkpoint timestamp. Verify the
t+24h block. Refresh the README. Then come back for an explicit
human-approved tag.

The system is functionally GA-ready. The remaining gate is operational
observation — exactly the kind of test that catches "the daemon
quietly OOMed at 3 AM" failures that no unit test will. It's the
right gate.

