# Cycle 20260513-163910 PLAN — Cycle 44 (ship FAIL-0008 .dockerignore)

## Target dimension

S (Safety gates) — closes a real secret-leak surface (`.env`
into docker layers per FAIL-0008). M-dim also touched (one
FAIL entry converts from `no` → `yes`). S/M both at L7 max; no
level move. Streak 24→25.

## Specific gap being closed

FAIL-0008 sits in the ledger tagged `empirically_reproduced: no`.
The symptom (docker build copying `state/`, `workspaces/`,
`.env` into image layers — 800MB+ images shipping credentials)
is well-understood but the working fix (a root `.dockerignore`
+ regression test) hasn't shipped.

The two Dockerfiles (`runner/Dockerfile`, `orchestrator/Dockerfile`)
both COPY their respective subdirectories — but per FAIL-0008's
analysis, `docker build .` uses the project root as the context
by default, so a root `.dockerignore` controls what gets sent
to the daemon.

This is the first cycle to convert a `no`-tagged FAIL entry to
`yes` per the verify-before-relying discipline (Cycles 33→43).

## Change being made

1. **`.dockerignore`** (new, at repo root): exclude
   - `state/` (live SQLite DBs + lock files)
   - `workspaces/` (per-issue clones, possibly GBs)
   - `.env*` (secrets — would leak into image layer; §0 rule 3)
   - `__pycache__/`, `*.pyc` (build noise)
   - `.venv/` (host's local interpreter)
   - `cycles/` (per-cycle artifacts; not needed at runtime)
   - `reports/runs/` (per-wake logs; not needed in image)
   - `worktrees/` (Track C2 worktrees; not needed)
   - `.git/`, `.hypothesis/` (build noise)

2. **`tests/test_dockerignore.py`** (new):
   - asserts `.dockerignore` exists at the repo root
   - asserts the 9 required patterns are present (one assertion
     per pattern, with a helpful error message)
   - asserts `.env` is excluded (§0 rule 3 — secrets MUST never
     leak)
   - (optional, docker-conditional) builds context tarball via
     `git ls-files` and asserts none of the excluded paths
     appear in it

3. **`FAILURES.md` FAIL-0008 entry**:
   - Change `empirically_reproduced: no (...)` to
     `empirically_reproduced: yes (Cycle 44; .dockerignore shipped
     + tests/test_dockerignore.py regression test)`
   - Update `**Working fix**:` from "planned (NOT YET SHIPPED)"
     to "SHIPPED in Cycle 44 (20260513-163910)"
   - Update `**Regression test**:` from "not yet" to point at
     the new test file

4. **Streak update via Scheduler API** (4th cycle using it).

## Acceptance criteria

- [x] `.dockerignore` exists at repo root with required patterns
- [x] `tests/test_dockerignore.py` has ≥ 10 assertions, all green
- [x] FAILURES.md FAIL-0008 updated: yes / SHIPPED / test cited
- [x] Failures-integrity test still green (FAIL-0008 now `yes`)
- [x] `pytest tests/ -q` green
- [x] `compute_level --check` green (after propose-first)
- [x] streak 24→25 via Scheduler API
- [x] FAILURES.md `no`-tagged count drops from 5 → 4

## Files to touch (closed set)

- `.dockerignore` (new)
- `tests/test_dockerignore.py` (new)
- `FAILURES.md` (FAIL-0008 update — 3 lines changed)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (note Cycle 44 done)
- `STATE.md` (rewrite)
- `cycles/20260513-163910/PLAN.md` (this)
- `cycles/20260513-163910/REPORT.md`
- `cycles/20260513-163910/RESULT.md`
- `cycles/20260513-163910/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (via Scheduler API)
- `reports/cycle-history.jsonl` (via Scheduler API)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.
- The two Dockerfiles (`runner/Dockerfile`,
  `orchestrator/Dockerfile`) — they already use `COPY . /workspace`
  patterns that benefit from a root `.dockerignore`; no change
  needed.

## Rollback plan

`git reset --hard autoevo/pre-20260513-163910`. Pure-add file +
metadata edits.

## Risk score

low. Adding a `.dockerignore` is strictly tightening — it
EXCLUDES paths from the build context. No existing behavior is
broken; any prior `docker build` that depended on `.env` being
in the image (which would itself be a §0 rule 3 violation) is
now correctly prevented.

## FAILURES.md pre-flight result

Keywords: dockerignore, docker, image, bloat, env, secret,
.dockerignore, sqlite (state/*.db excluded; preflight match).

- **FAIL-0008** matched (target of this cycle).
  Per the new Cycle 42 ORIENT instruction, the entry's
  `empirically_reproduced` field is currently `no` — so this
  cycle must either (a) pick a different approach OR (b)
  reproduce empirically and update the entry. **This cycle
  chooses (b)**: it ships the working fix AND a regression
  test, converting the entry's tag to `yes`.
- **FAIL-0007** matched on `sqlite`. **Cited and
  disambiguated**: FAIL-0007 is about SQL record_run idempotency
  on the `(issue_id, role, started_at)` natural key — a database
  row-count bug to be fixed by an INSERT OR IGNORE migration in
  a future cycle. This cycle's use of "sqlite" is in the
  `.dockerignore` rationale text only: it excludes `state/*.db`
  from docker build context so live SQLite database files don't
  leak into image layers. Different system, different layer —
  this cycle does NOT touch `orchestrator/db.py:record_run`,
  the SQL schema, or the idempotency code path.

## Open questions / blockers

None.
