# M22 — GA Decision Report

**Status**: PARTIAL · Phase 0 + 1 complete · **STOP per directive hard rule #6** (<24h elapsed)

**Predecessor tag**: `v1.0.0-beta.2`
**Target tag** (gated on full M22 + explicit user approval): `v1.0.0`

**GA STATUS: NO-GO**

---

## Phase 0 — Verify current state ✅

| Field | Value |
|---|---|
| Current UTC | `2026-05-24T22:33:35Z` |
| Branch | `claude247/v1` |
| Local HEAD | `881a586459becd26b36bac6573ef333483d585ea` |
| `claude247/v1` (local + remote) | `881a586` (in sync) |
| `main` (local + remote) | `560227e` = `v1.0.0-beta.2` (unchanged from M20) |
| Latest tag | `v1.0.0-beta.2` |
| GA tag `v1.0.0` exists | **NO** |
| GH releases visible | alpha.0 / alpha.1 / beta.0 / beta.1 / beta.2 (no GA) |
| `pytest -q` | **526 passing** in 15.00s |
| `doctor` | **OK** (2 known non-blocking warnings: docker daemon offline by design; dashboard-port-busy is our own daemon) |
| `status --plain` | system running; 0 active tasks; 0 stuck; 6 awaiting approval (historical M19/M20 fixtures) |
| launchd 4 services | ✓ all loaded; dashboard pid 42273 since 2026-05-24 ~19:57 UTC, `/healthz` → `{"ok": true}` |
| Schema version | `v4` (M21-P2 migration applied) |

## Phase 1 — Soak check ⏳ PARTIAL (STOP)

### Wallclock math

| Anchor | Time |
|---|---|
| M20-P2 launchd install | `2026-05-24T19:57Z` (dashboard KeepAlive T0) |
| M20-P3 dispatcher reload after E2E iteration | `2026-05-24T21:46Z` (dispatcher effective T0) |
| M21 commits + push | `2026-05-24T21:46Z`–`22:30Z` |
| **Current** | **`2026-05-24T22:33:35Z`** |

### Elapsed

| Service | Elapsed |
|---|---|
| Dispatcher (post M20-P3 reload) | **~47 minutes** |
| Dashboard (KeepAlive since M20-P2) | **~2 hours 36 minutes** |

**Both are dramatically less than 24 hours.**

Per M22 directive hard rule #6: "If elapsed time is less than 24h,
stop after reporting partial status." → **STOP here.**

### Health snapshot at current checkpoint

| Probe | Result |
|---|---|
| launchd `com.claude247.dashboard` | loaded, pid 42273 live, last_exit 0 |
| launchd `com.claude247.orchestrator` | loaded, scheduled (60s tick), last_exit 0 |
| launchd `com.claude247.dispatcher` | loaded, scheduled (30s tick), last_exit 0 |
| launchd `com.claude247.backup` | loaded, scheduled (daily 03:17 UTC), last_exit 0 |
| Dashboard `/healthz` | `{"ok": true}` |
| dispatcher.err.log | 1.6 KB total; contents are 2 historical `start_task handler raised` lines from the M20-P3 series (20:43 = gpt-5 org-gate 404; 20:53 = OpenAI Cloudflare 520). Both root-caused and fixed before beta.2. No new errors since 21:46 dispatcher reload. |
| dispatcher.out.log | 3.3 KB; last 3 lines all `idle: queue empty` (healthy idle pattern, no crash loop) |
| Orphan `running` commands | **0** |
| Active tasks (queued / planning / coding / testing / reviewing / validating) | **0** |
| Stuck tasks | **0** |
| `claude247 logs search "ERROR/Exception/Traceback/stuck"` | empty except for the 2 historical entries above |
| repos.yaml load | ✓ 1 repo registered |
| Budget counters | sane (production cap of 3 restored at end of M20-P3) |

**Trajectory looks correct** for a clean 24h soak. None of the
classic failure modes are visible at T+47m: no crash loop, no orphans,
no alert storm, no error spew. But "looks correct at 47m" is not
"PASS at 24h." The actual gate is wall-clock observation, not
inferred health.

## What was NOT done in this M22 session

Per directive hard rule #6 + #7, the following phases were skipped
because the soak gate is still red:

- ❌ Phase 2 — README / docs refresh (deferred until soak resolves;
  doing it now risks two doc passes if the soak fails)
- ❌ Phase 3 — re-evaluate GA_GATE.md 19 gates
- ❌ Phase 4 — optional `is_odd` E2E (skipped per its own GATE — budget
  on `auto-evo-playground` is also still exhausted)
- ❌ Phase 5 — GO/NO-GO + approval request
- ❌ Phase 6 — release sequence

`main` is **not** modified. **No `v1.0.0` tag was created. No GitHub
Release was created.**

## Final 11 answers (per directive Phase 5 template)

Even though Phase 5 isn't formally executed, here are the directive's
required answers as a snapshot:

1. **Did T+24h soak fully pass?** ❌ NO — only ~47 min elapsed; soak status PARTIAL.
2. **Are all launchd services healthy?** ✅ YES — 4/4 loaded, dashboard live.
3. **Is dashboard reachable?** ✅ YES — `/healthz` → `{"ok": true}`.
4. **Are logs searchable?** ✅ YES — log_indexer FTS5 working.
5. **Are there orphan commands/tasks?** ✅ NO — 0 orphans, 0 active.
6. **Did full tests pass?** ✅ YES — 526 passing.
7. **Are docs current?** ⏳ PARTIAL — README hasn't been refreshed for M20/M21 yet (was scheduled for Phase 2 of this session but skipped per hard rules).
8. **Are 19/19 GA gates green?** ❌ NO — gate #1 (24h soak) is the blocker; gate #19 (docs) is also still pending the README refresh. 17/19 remain green from M21.
9. **Is v1.0.0 recommended?** ❌ **NO**.
10. **If not, what exactly blocks it?**
    - GA_GATE #1: 24h soak — wallclock only.
    - GA_GATE #19: README/docs refresh — writing only.
11. **If yes, what release steps are proposed?** N/A (not yet GO).

## Recommended next action

Wait. Then re-run M22 in a future session — call it M22b — after
**at least 24 hours have actually elapsed** from the dispatcher T0
(2026-05-24 21:46 UTC). The earliest valid re-run window is
**2026-05-25 21:46 UTC** (or later if any restart resets T0).

When that window arrives:

1. Re-run M22-P0 to confirm baseline (tests + doctor + launchd).
2. Re-run M22-P1 with the same health-check block. This time
   elapsed >= 24h, so this is the real T+24h checkpoint.
3. If all pass: continue with M22-P2 (docs refresh), M22-P3 (GA gate
   re-evaluation), M22-P5 (GO/NO-GO).
4. If anything failed during the soak window: write
   `M22_SOAK_BLOCKERS.md` and stay NO-GO until fixed.

**Until then, `main` stays at `v1.0.0-beta.2` and no v1.0.0 tag exists.**

---

## M22b — Watchdog dashboard added (2026-05-24)

A read-only watchdog dashboard was added so the operator can see live
soak progress and GA-readiness state at any moment during the wait
without re-reading log files.

| Field | Value |
|---|---|
| M22b watchdog dashboard added | YES |
| Entry point | `claude247 status-board` (alias: `claude247 watchdog`) |
| Outputs | `--plain`, `--json`, `--write-md PATH` |
| FastAPI route | `/status-board` (HTML) + `/status-board.json` |
| Generated markdown snapshot | [M22_WATCHDOG_DASHBOARD.md](M22_WATCHDOG_DASHBOARD.md) |
| Read-only contract | Enforced by `tests/unit/test_status_board.py::test_read_only_does_not_mutate_db` |
| Tests added | 34 (3 unit files + 1 integration file) |
| Tests result | 560 passing total (was 526; +34 new) |

### Snapshot at M22b implementation time

| Section | Value |
|---|---|
| Generated | `2026-05-24T23:08Z` |
| Current GA status | **NO-GO** |
| Current soak progress | **PARTIAL** — 01h 22m / 24h, 5% |
| Current runtime health | **HEALTHY** — 4/4 launchd loaded; dispatcher / dashboard / notifier / doctor all green |
| Queue | clean — 0 active, 0 stuck, 0 orphan, 6 historical approvals |
| Recent signals | 0 new critical errors, 5 historical; no alert storm; budget sane; logs searchable |
| GA gates | **17 / 19 passed**; blockers = (1) 24h soak PASS, (2) Docs current |
| Next action recommendation | `wait_for_24h_soak` |

### Next exact command (when re-running M22 → M22c)

After the dispatcher T0 (`2026-05-24T21:46Z`) plus 24 hours has elapsed,
i.e. on or after `2026-05-25T21:46Z`:

```bash
# 1. live watchdog snapshot
claude247 status-board --plain

# 2. write a checkpoint markdown
claude247 status-board --write-md M22_WATCHDOG_DASHBOARD.md

# 3. classic full M22-P0 / M22-P1 checks
.venv/bin/pytest -q
scripts/doctor_launchd.sh || true
claude247 doctor --plain
```

If the watchdog reports `soak.result == "PASS"` AND `ga_gates.recommendation
== "request_ga_approval"`, only then proceed to the (still operator-gated)
GA tag sequence. Until then, **do not** tag `v1.0.0`, **do not** merge
into `main`, **do not** cut a GitHub release.

### Why this is safe to add now (during the soak)

* All data access is SELECT-only against the SQLite state DB.
* `launchctl list` is invoked read-only; no service is loaded / unloaded.
* Dashboard `/healthz` is a 2-second-timeout GET.
* No changes to dispatcher, runner, validator, merge policy, or budget.
* New module + CLI command + FastAPI route only — no edits to
  `orchestrator/dispatcher.py`, `orchestrator/task_manager.py`, or
  any launchd plist.
* The running dashboard daemon will pick up the new `/status-board`
  routes on its next restart; until then the CLI works regardless.

---

## M22b owner waiver — early v1.0.0 release (2026-05-25)

**GA DECISION: APPROVED BY OWNER WITH EXPLICIT SOAK WAIVER.**

The original 24h soak gate did not reach full wall-clock duration
before release. The owner explicitly approved early `v1.0.0` release
after **~9h+ of healthy soak evidence**.

### Observed soak evidence at decision time

| Probe | Value |
|---|---|
| Elapsed since dispatcher T0 (`2026-05-24T21:46Z`) | **~9h 12m / 24h (~38.4%)** |
| launchd services loaded | **4 / 4** |
| Dashboard `/healthz` | OK |
| Dispatcher healthy idle ticks (every 30s) | **~1182** |
| Backup job (daily, local hour 03) | **Completed** — `claude247-20260525T011703Z.db` (2.06 MB) created; dispatcher continued working after |
| Active tasks | 0 |
| Stuck tasks | 0 |
| Orphan running commands | 0 |
| New alerts since T0 | 0 |
| Structured log errors since T0 | 0 |
| Anthropic worker spend since T0 | **$0.0000** |

### Known yellow flag

- One early sqlite schema-migration race at **T0 + 7 minutes**
- self-healed
- not repeated
- dispatcher continued healthy afterward

### Owner waiver

- 24h soak full PASS is **waived** for the `v1.0.0` release
- Final T+24h observation remains a post-GA follow-up
- The waiver is documented (this report), gated (`GA_GATE.md` gate
  #1 = `WAIVED_BY_OWNER`, not `PASS`), and dated (2026-05-25)
- Per hard rule #4 added to `GA_GATE.md` in this same release:
  `WAIVED_BY_OWNER` ≠ `PASS`. The original criterion remains
  visible.

### Pre-release validation

| Check | Result |
|---|---|
| `pytest -q` | **566 passing** in 17.34s |
| `claude247 doctor --json` | `ok=True`, 0 fails, 3 known non-blocking warns (docker daemon offline by design; dashboard port busy = our own daemon; validator API keys not in shell env — dispatcher uses `secrets.env`) |
| `claude247 status --plain` | system running, 0 active, 0 stuck, 6 historical approval items from M19/M20 fixtures, 1 repo enabled |
| `scripts/doctor_launchd.sh` | 4/4 services healthy |

### Post-GA follow-up commitments

1. Record final T+24h soak result after `2026-05-25T21:46Z` in
   `M22c_SOAK_FINAL.md`. The watchdog dashboard will auto-flip
   `soak.result` to `PASS` or `FAIL` once the wall-clock crosses 24h.
2. If anything failed during the post-waiver window, open a v1.0.1
   hotfix issue.
3. Schema v5 migration (add `runs.input_tokens` / `runs.output_tokens`
   columns) — queued for post-GA so the in-flight dispatcher is not
   disturbed mid-soak.

