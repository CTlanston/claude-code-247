# Cycle 20260513-052318 PLAN — Phase B Cycle 28 (status dashboard)

## Target dimension

INFRA (no dim move). Phase B step 4 of the launchd-driven 7×24
infrastructure stack. Deliverable is the read-only operator
dashboard + tests + a doctor wire-up. No rubric move expected.

## Specific gap being closed

After Cycle 27, the L7 launchd agent CAN be installed by the
operator. But the operator needs a one-liner to check progress
without grovelling through 8 different files. This cycle ships
`scripts/autodev_status_dashboard.sh` — a read-only one-screen
summary of Overall L, per-dim levels, C-streak progress, recent
cycle activity, stop-condition presence, recent wake events, and
the launchctl status of both the L7 and v3 agents.

## Change being made

1. Create `scripts/autodev_status_dashboard.sh` — read-only.
   Per the kickoff doc spec, with adjustments for actual file
   names on disk (the kickoff doc says
   `reports/c-deadlock-streak.json` but the real file is
   `reports/zero-deadlock-streak.txt`; the dashboard reads the
   actual file).

   Sections (each emitted with a header line):
   - **Overall Level** — grep `Overall L` from `LEVEL.md`
   - **Per-dim** — head -8 of `LEVEL.md` (the dim-by-dim table)
   - **C Streak** — read `reports/zero-deadlock-streak.txt`,
     format as `current/30` with cycles remaining
   - **Last 5 cycles** — tail -5 of `CHANGELOG.md`
   - **Stop conditions** — list any of AUTODEV_DONE.md,
     STOPSWITCH, BLOCKED.md, quota-rate-limit-until.ts
   - **Last 5 wake events** — tail -5 of `reports/runs/launchd.log`
     if it exists (otherwise "no launchd log yet")
   - **launchctl status** — `launchctl list | grep autodev`
     output. Surfaces BOTH L7 (`com.lanston.autodev.continuous`)
     and v3 (`com.autodev.supervisor`) agents. In dry-run, skips
     launchctl entirely.

   Env knobs:
   - `AUTODEV_REPO_ROOT` — repo path (default: script's parent of
     parent). Tests use a tmp_path here.
   - `AUTODEV_DASHBOARD_DRY_RUN` — skip launchctl calls (tests
     set this).

   Exit 0 always (it's a read-only command; nothing to fail).

2. Extend `scripts/autodev_doctor.sh` to check the dashboard
   script is present and executable. This brings doctor to 13
   passed (was 12). A future test or operator who relies on the
   exact count can read it from the summary line.

3. Add `tests/test_autodev_status_dashboard.py` — covers:
   - Script exists + executable
   - Bare run exits 0
   - Each section header is emitted
   - Reads Overall L from LEVEL.md
   - Reads streak from `reports/zero-deadlock-streak.txt`
   - Surfaces STOPSWITCH when present
   - Surfaces BLOCKED.md when present
   - Surfaces AUTODEV_DONE when present
   - "no launchd log yet" hint when log is missing
   - Tails CHANGELOG.md content

## Acceptance criteria

- [x] `scripts/autodev_status_dashboard.sh` exists, executable
- [x] `tests/test_autodev_status_dashboard.py` ≥10 tests
- [x] `pytest tests/ -q` green
- [x] `compute_level.py --check` green (after propose-for-cycle)
- [x] `autodev_doctor.sh` exits 0 (now 13 checks)

## Files to touch (closed set)

- `scripts/autodev_status_dashboard.sh` (new)
- `scripts/autodev_doctor.sh` (extend by ~5 lines)
- `tests/test_autodev_status_dashboard.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark Cycle 28 done, surface Cycle 29 P0)
- `STATE.md` (rewrite)
- `cycles/20260513-052318/PLAN.md` (this)
- `cycles/20260513-052318/REPORT.md`
- `cycles/20260513-052318/RESULT.md`
- `cycles/20260513-052318/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (bump 8→9)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md` (computed), anything in §0.

## Rollback plan

`git reset --hard autoevo/pre-20260513-052318` is the fallback.
Pure-add cycle (dashboard + tests + small doctor extension).

## Risk score

low. The doctor extension is a single conditional ok/warn block
following the existing pattern (line 67-71). No production code
touched.

## FAILURES.md pre-flight result

Keywords: dashboard, status, launchctl, doctor, streak.

- No FAILURES.md keyword matches. FAIL-0009 (doctor session-log
  side-effect) is the only doctor-related entry, and this cycle
  doesn't trigger that path (the doctor's CLI-classify import
  is unchanged; only the new dashboard check is added).

## Open questions / blockers

None.
