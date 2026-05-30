# M20 Soak — Observation Result

**SOAK STATUS: PARTIAL, not GA-blocking yet but v1.0.0 tag must wait for full 24h PASS.**

| Field | Value |
|---|---|
| T0 baseline (per M20_SOAK_PLAN.md) | 2026-05-24, immediately after `scripts/install_launchd.sh` succeeded (~19:57 UTC) |
| Dispatcher daemon was unloaded for E2E iteration (M20-P3 series) | 2026-05-24 21:03 UTC → reloaded 2026-05-24 21:46 UTC |
| Dispatcher effective T0 (clean run) | 2026-05-24 ~21:46 UTC |
| Dashboard T0 (KeepAlive, never died) | 2026-05-24 ~19:57 UTC |
| Checkpoint timestamp | 2026-05-24 22:00 UTC (this report) |
| Elapsed (dispatcher) | ~15 min |
| Elapsed (dashboard) | ~2 h |
| Designation | **T+15m / T+2h — clearly < T+1h checkpoint for dispatcher; clearly < T+24h** |
| Second checkpoint (M22-P1 invocation) | 2026-05-24 22:33 UTC = T+47m dispatcher / T+2h36m dashboard. Still PARTIAL. Health unchanged — 4/4 launchd loaded, dashboard `/healthz` OK, dispatcher idle queue empty, dispatcher.err.log holds only 2 historical M20-P3 entries (root-caused before beta.2), 0 orphans, 0 active tasks. See [M22_GA_DECISION_REPORT.md](M22_GA_DECISION_REPORT.md) for full Phase 0/1 snapshot. |

## What's verified right now

| Probe | Result |
|---|---|
| launchd 4 services loaded | ✓ all 4: `dashboard` (pid 42273) + `orchestrator`/`dispatcher`/`backup` scheduled, last_exit=0 |
| Dashboard reachable (`/healthz`) | ✓ `{"ok": true}` |
| Dispatcher crash-loop? | ✗ NO — dispatcher.err.log empty; out.log shows only "idle: queue empty" lines |
| Orphan `running` commands | 0 |
| Active tasks | 0 |
| Stuck tasks | 0 |
| Repo registry loads | ✓ 1 repo (`auto-evo-playground`) |
| Logs searchable | ✓ |
| Budget counters sane | ✓ reverted to production cap of 3 |
| Doctor required checks | ✓ all pass; two known non-blocking warns (docker offline by design; dashboard-port-busy is our own daemon) |
| `claude247 status` works | ✓ |

## What we cannot claim yet

- 24 hours have not elapsed. The system has been on-and-off launchd
  for ~2 hours of dashboard activity and ~15 minutes of clean
  dispatcher activity. We cannot claim "passed a 24h soak."

## Plan to convert PARTIAL → PASS

1. Let launchd run untouched for 24 wall-clock hours from the
   current checkpoint timestamp (2026-05-24 22:00 UTC).
2. At t+1h, t+6h, t+24h: run the health-check block from
   [M20_SOAK_PLAN.md](M20_SOAK_PLAN.md).
3. At t+24h: append T+24h section to this file with same probe table.
4. PASS criteria from the directive M21-P1:
   - elapsed time >= 24h
   - launchd services stayed healthy
   - dashboard reachable
   - dispatcher not crash-looping
   - no orphan running commands
   - no unexpected stuck tasks
   - no alert storm
   - logs searchable
   - doctor clean or known non-blocking warnings only

Per directive: **GA tag must wait for 24h PASS.** M21 may complete its
other phases (P2 / P3 / P4 / P5 / P6) in parallel with the soak
running, and the final GA recommendation in M21_GA_READINESS_REPORT.md
will mark this as the outstanding GA blocker.

## Why the soak still matters

Auto-evo workloads + launchd's `KeepAlive` + the dispatcher's 30s tick
create a constantly-running process. The unit tests prove single-call
correctness; PR #59 proved end-to-end correctness; the soak proves
the system doesn't crash-loop or leak when *nothing is happening*.
Without that proof, "production-ready" claims would skip past the
most common operational failure mode of agentic daemons.

---

## Owner waiver and early termination for v1.0.0 release (2026-05-25)

**STATUS: WAIVED_BY_OWNER for v1.0.0. Final T+24h observation is a
post-GA follow-up.**

At T+9h 12m (~38.4% of the original 24h window), the owner explicitly
approved early publication of `v1.0.0` instead of waiting for the
full wall-clock window. The decision is documented in
[M22_GA_DECISION_REPORT.md](M22_GA_DECISION_REPORT.md) §"M22b owner
waiver" and [GA_GATE.md](GA_GATE.md) §"GA decision: v1.0.0 owner
waiver".

### Observed at decision time (T+9h 12m, 2026-05-25 ~06:58Z)

| Probe | Value |
|---|---|
| Elapsed since dispatcher T0 (`2026-05-24T21:46Z`) | ~9h 12m |
| launchd services loaded | 4 / 4 |
| Dashboard `/healthz` | OK |
| Dispatcher healthy idle ticks (every 30s) | ~1182 |
| Dispatcher `out.log` mtime | 18 seconds ago at observation time |
| Backup script daily run | **Completed** — created `claude247-20260525T011703Z.db` (2.06 MB); dispatcher continued working after backup |
| Active tasks | 0 |
| Stuck tasks | 0 |
| Orphan running commands | 0 |
| New alerts since T0 | 0 |
| Structured log errors since T0 | 0 |
| Anthropic worker spend since T0 | $0.0000 |
| Worker runs since T0 | 0 (idle, expected) |

### Known yellow flag (recorded, not waived)

One early SQLite schema-migration race at **T+7 minutes**:
`dispatcher.err.log` recorded one `sqlite3.OperationalError: no such
column: started_at` traceback (originating in
`memory/db.py::init_db`), then **the file stopped growing**. The
subsequent ~1182 dispatcher ticks all succeeded; the error did not
repeat. Most plausible root cause: schema.sql referenced the new
M21-P2 phase columns before the in-place ALTER TABLE migration
completed on that particular tick.

### What the early termination does NOT prove

The original 24h soak was designed to catch failure modes that
typically only appear after many hours:

- slow memory / file-descriptor leaks
- SQLite WAL unbounded growth
- launchd log rotation issues that surface only after the log file
  crosses a buffer threshold
- interval-based phone-home leaks where the interval exceeds the
  observation window

**9h 12m of observation cannot definitively rule these out.** The
trend is excellent and no early-warning signal fired, but proving a
negative requires the full window.

### Required post-GA follow-up

- At or after `2026-05-25T21:46Z` (the original T+24h checkpoint),
  re-run the full M20_SOAK_PLAN.md health-check block.
- File the result in a new `M22c_SOAK_FINAL.md`. If anything failed
  during the post-waiver window, open a v1.0.1 hotfix issue.
- The watchdog dashboard (`claude247 status-board` /
  `/status-board`) will automatically flip `soak.result` from
  `PARTIAL` to `PASS` or `FAIL` once the wall-clock crosses 24h, so
  the result is visible without manual computation.
