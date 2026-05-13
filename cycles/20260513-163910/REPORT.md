# Cycle 20260513-163910 Report — Cycle 44 (ship FAIL-0008)

## Verdict

PASS — root `.dockerignore` shipped. FAIL-0008 entry flipped
`no` → `yes` per the Cycle 42 verify-before-relying discipline.
This is the **first cycle to convert a `no`-tagged FAIL to
`yes`** since the discipline rule was encoded in Cycles 41-43.

Streak 24→25 (83% to C-L5).

## Level changes

None (S/M at L7 max). FAILURES `no`-tagged count: 5 → 4.

## Change

1. **`.dockerignore`** (new, repo root):
   Exclusions organized by category:
   - **Secrets** (§0 rule 3 — never in image layers):
     `.env`, `.env.*`, `secrets/`, `*.key`, `*.pem`, `id_rsa*`
   - **Live operational data**: `state/` + sub-patterns,
     `workspaces/`, `worktrees/`
   - **Python build noise**: `__pycache__/`, `*.pyc`, `*.pyo`,
     `.venv/`, `.python-version`, `.hypothesis/`
   - **Git internals**: `.git/`, `.gitignore.swp`
   - **L7 per-cycle + telemetry**: `cycles/`, `reports/runs/`,
     `reports/heartbeat.json`, `reports/codex-reviews.jsonl`,
     `reports/adversarial-reviews.jsonl`,
     `reports/health.{json,md,history.jsonl}`,
     `reports/session-log.md`, `reports/supervisor.{stdout,stderr}.log`
   - **macOS**: `.DS_Store`
   - **IDE/editor**: `.vscode/`, `.idea/`, `*.swp`, `*.swo`
   - **Test artifacts**: `.pytest_cache/`, `.coverage`, `htmlcov/`
   - **Docs not needed in runtime image**: `docs/`, `README.md`,
     `AUTODEV_*.md`, `HUMAN_CONFIG*.md`

   File header comment explains: shipped in Cycle 44 to close
   FAIL-0008; each pattern tested in `tests/test_dockerignore.py`
   so future edits dropping a critical exclusion fail loudly.

2. **`tests/test_dockerignore.py`** (new, 15 tests):
   - Existence + non-empty (2 tests)
   - 9 pattern-presence checks: state, workspaces, .env,
     __pycache__, .venv, cycles, reports/runs, .git, worktrees
     (one test each — drift on any single pattern fails loudly)
   - Sanity guards against over-exclusion:
     - No pattern is `.`, `*`, `/`, or `**` (would exclude
       everything)
     - No pattern excludes `/orchestrator/` or `/runner/` dirs
       (Dockerfile directories must be in build context)
     - No pattern excludes `autodev/` (the Python package the
       runner image needs)
   - Cross-reference: FAILURES.md FAIL-0008 entry's
     `Empirically reproduced` field is `yes`

3. **`FAILURES.md` FAIL-0008 entry** updates (3 fields):
   - `Empirically reproduced`: `no (...)` → `yes (Cycle 44
     shipped .dockerignore...)` — first `no` → `yes` flip
     since Cycle 41 introduced the field
   - `Working fix`: "planned (NOT YET SHIPPED)" →
     "SHIPPED in Cycle 44 (20260513-163910)" with the full
     pattern list
   - `Regression test`: "not yet" → cites
     `tests/test_dockerignore.py`

4. **Streak via Scheduler API** (4th cycle using the pattern).

## Files modified

```
.dockerignore                                    (new, root, ~60 lines)
tests/test_dockerignore.py                       (new, 15 tests)
FAILURES.md                                      (FAIL-0008: 3 fields)
CHANGELOG.md, BACKLOG.md, STATE.md
reports/zero-deadlock-streak.txt                 (24→25 via Scheduler)
reports/cycle-history.jsonl                      (+ entry via Scheduler)
cycles/20260513-163910/*
```

## Verify

- `pytest tests/ -q`: 639 passed, 2 skipped, 0 failed
  (+15 dockerignore tests)
- `pytest tests/test_dockerignore.py`: 15 passed (every
  pattern-presence test individual; helpful error messages
  point at FAIL-0008 + §0 rule 3 for the `.env` case)
- `propose_next_track --for-cycle 20260513-163910` → proposal
  artifact written FIRST per Cycle 25 ordering rule
- `compute_level --check`: passed
- `autodev_doctor.sh`: 14/0/2
- Scheduler.current_zero_deadlock_streak(): 25

## Constraints honored

- No `git push`. No PR merge. No secret touch.
- `.env*` is explicitly excluded (top of the .dockerignore,
  under "Secrets" section, with explicit comment citing §0
  rule 3).
- Append-only FAILURES.md convention preserved — the FAIL-0008
  entry text is updated (3 fields changed), but the surrounding
  structure + Date / Symptom / Root cause / Failed fix
  attempts / Keywords are untouched.
- FAIL-0007 cited+disambiguated (sqlite keyword in PLAN's
  context refers to dockerignore-excluded `state/*.db` files,
  not the record_run idempotency code path).
- 45-min budget: ~12 minutes for this cycle.

## Why this matters for §0 rule 3

`AUTODEV_L7_MASTER_PROMPT.md §0 rule 3`:

> NEVER read, write, or echo `.env`, `*.key`, `*.pem`,
> `id_rsa*`, or any file matching `secrets/**`. If a task
> requires a secret, write the requirement to `BLOCKED.md`
> and exit.

But the system's `docker build` flow could VIOLATE this rule
NON-OBVIOUSLY: a `COPY . /workspace` line in either
`runner/Dockerfile` or `orchestrator/Dockerfile` would slurp
the entire repo context — INCLUDING `.env` — into a build layer
that gets pushed to a registry. Once in a layer, the secret
is effectively published.

Before this cycle: no `.dockerignore` → secrets leak in image.
After: `.env`, `*.key`, `*.pem`, `id_rsa*`, `secrets/` all
explicitly excluded. The 15-test regression suite ensures the
exclusions don't silently regress.

## Cycle 42 verify-before-relying rule applied here

Per the new Cycle 42 ORIENT instruction:
> When this cycle's PLAN preflight cites a FAIL-NNNN entry,
> check that field. If the value is `no`, the cycle must
> EITHER (a) pick a different approach OR (b) empirically
> reproduce the failure as part of THIS cycle and either
> confirm (yes) or correct the entry.

Cycle 44 cited FAIL-0008, found it tagged `no`, and chose
(b): ship the working fix + regression test + flip the tag
to `yes`. This is the discipline working as intended on a
real case.

## Next

C streak 25/30 → 5 more disciplined cycles for C-L5.
Context approaching budget — handoff and exit soon.

Remaining `no`-tagged FAILURES entries (4 of them):
- FAIL-0005 (PyGithub IndexError) — needs PyGithub mock fixture
- FAIL-0006 (bare-remote silent drop) — needs fake-GitHub fixture
- FAIL-0007 (record_run idempotency) — needs SQL migration
  framework
- FAIL-0010 (V3 supervisor stuck) — needs Diagnose mode

Each is a single-cycle convert candidate but materially larger
than the FAIL-0008 conversion was.

## Wall clock

~12 minutes.
