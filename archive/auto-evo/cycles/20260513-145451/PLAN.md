# Cycle 20260513-145451 PLAN — Cycle 38 (wire health into doctor)

## Target dimension

S (Safety gates). Closes the §10 "Doctor should call it as
part of pre-flight" gap. No level move (S at L7 max).
Streak bump only (18→19).

## Specific gap being closed

Cycle 37 shipped `orchestrator/health.py` and the wake script
reads its output, but the doctor doesn't yet surface the health
state. §10 of the master prompt says:
> `scripts/autodev_health.sh` is the CLI entrypoint. Doctor
> (`autodev_doctor.sh`) should call it as part of pre-flight.

**Critical design constraint**: the doctor must NOT cause new
side-effects on the tree. Cycle 33 just fixed FAIL-0009 (pytest
dirtying session-log.md). Having the doctor call
`autodev_health.sh` would write 3 files
(`reports/health.json` + `health.md` + `health.history.jsonl`)
on every doctor run, re-introducing the same class of bug.

**Resolution**: doctor READS `reports/health.json` if it exists,
reports score + status, and exits 0. Doctor does NOT invoke
the health emitter directly. The wake script emits health.json
on its own cadence (or the operator runs the CLI manually).
This keeps doctor strictly read-only.

## Change being made

1. **`scripts/autodev_doctor.sh`** (~8-line addition):
   New check after the existing v5_live_sanity + status_dashboard
   checks:
   ```bash
   # Cycle 38 — Track H wire: surface health.json if present
   if [[ -f reports/health.json ]]; then
     score=$(python3 -c "import json; print(json.load(open('reports/health.json'))['score'])" 2>/dev/null || echo "?")
     status=$(python3 -c "import json; print(json.load(open('reports/health.json'))['status'])" 2>/dev/null || echo "?")
     if [[ "$score" =~ ^[0-9]+$ ]] && (( score >= 50 )); then
       ok "health score=$score ($status)"
     else
       warn "health score=$score ($status) — below 50; wake script will skip dispatch"
     fi
   else
     warn "reports/health.json missing (run scripts/autodev_health.sh)"
   fi
   ```

2. **`tests/test_doctor_health_check.py`** (new):
   - Doctor surfaces "health score=N (status)" when health.json
     exists with a green score
   - Doctor warns when health.json missing
   - Doctor warns when score < 50 ("below 50")
   - Doctor does NOT modify reports/health.json (read-only)
   - Doctor does NOT modify reports/session-log.md (FAIL-0009
     regression guard — still holds after this cycle)
   - Doctor still exits 0 when health is fine (no behavior
     regression on existing 13/0/2)

## Acceptance criteria

- [x] `scripts/autodev_doctor.sh` extended (~8 lines)
- [x] `tests/test_doctor_health_check.py` ≥ 5 tests, all green
- [x] `pytest tests/ -q` green (no regression)
- [x] `bash scripts/autodev_doctor.sh` exits 0 and prints a
      "health score=" line
- [x] FAIL-0009 regression guard still passes
- [x] `compute_level --check` green (after propose-first)
- [x] `autodev_doctor.sh`: pass count goes 13 → 14 (health
      check added), fail 0, warn unchanged

## Files to touch (closed set)

- `scripts/autodev_doctor.sh` (~8-line append)
- `tests/test_doctor_health_check.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (note doctor-wire done)
- `STATE.md` (rewrite)
- `cycles/20260513-145451/PLAN.md` (this)
- `cycles/20260513-145451/REPORT.md`
- `cycles/20260513-145451/RESULT.md`
- `cycles/20260513-145451/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (18→19)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.
- `orchestrator/health.py` — Cycle 37's work; this cycle is
  pure-additive doctor wiring.

## Rollback plan

`git reset --hard autoevo/pre-20260513-145451`.

## Risk score

low. ~8 lines of additive shell + 1 new test file. The
read-only design eliminates the FAIL-0009 dirty-tree risk.

## FAILURES.md pre-flight result

Keywords: doctor, health, score, json, side-effect.

- **FAIL-0009** matched on `doctor`. **Cited and disambiguated**:
  FAIL-0009 was about the doctor dirtying session-log.md via the
  cli-executor unit tests (Cycle 33 fixed via env-var gate). This
  cycle's doctor change is STRICTLY READ-ONLY: it reads
  `reports/health.json` if present and prints a status line.
  No new write side-effects. The PLAN's acceptance criteria
  explicitly include a FAIL-0009 regression guard.
- No other FAILURES.md matches.

## Open questions / blockers

None.
