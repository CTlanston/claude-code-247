# Claude247 Watchdog Dashboard

**Generated:** `2026-05-24T23:08:21Z`

> This dashboard is read-only. A non-`PASS` soak means **DO NOT**
> tag `v1.0.0`. Re-run after the elapsed time crosses 24h.

## Summary

| Area | Status |
|---|---|
| GA | NO-GO |
| Soak | PARTIAL |
| Runtime | HEALTHY |
| Queue | CLEAN |
| Gates | 17/19 passed |
| Next action | `wait_for_24h_soak` |

## Release State

- `main`: `560227ebb6f29f3bec6753f26caadf884a608880` (v1.0.0-beta.2)
- `claude247/v1`: `1b17de8c05ab4934afa713d8f42a59b8c9a3626f`
- `v1.0.0` tag exists: **NO**

## Soak Progress

- T0: `2026-05-24T21:46:00Z`
- elapsed: 01h 22m of 24h 00m required
- progress: `[#-------------------] 5%`
- result: **PARTIAL**
- earliest full check: `2026-05-25T21:46:00Z`

## Runtime Health

| Probe | Result |
|---|---|
| launchd | 4/4 loaded |
| dispatcher | healthy |
| dashboard | healthy |
| notifier | healthy |
| doctor | ok |

## Queue and Tasks

| Metric | Count |
|---|---|
| repos enabled | 1 |
| active tasks | 0 |
| stuck tasks | 0 |
| need approval | 6 |
| orphan commands | 0 |
| pending commands | 0 |

## Recent Signals

- new critical errors (last hour): **0**
- known historical errors: 5
- alert storm: **NO**
- budget: sane
- logs searchable: YES

## GA Gate Progress

- passed: **17/19**
- blocked:
  - 24h soak PASS
  - Docs current (README + docs/ + DoD + CHANGELOG)
- recommendation: `wait_for_24h_soak`

## Commands to Run Next

```bash
claude247 status-board --plain
claude247 doctor --json
scripts/doctor_launchd.sh || true
```

---

**Final reminder:** this dashboard is *not* a 24h soak PASS by
itself. Do not tag `v1.0.0` until soak result is `PASS` *and*
all GA_BLOCKER gates are closed.
