# Cycle 20260513-051843 PLAN — Phase B Cycle 27 (launchd installer)

## Target dimension

INFRA (no dim move). Phase B step 3 of the launchd-driven 7×24
infrastructure stack. Deliverable is the plist generator/installer
+ regression tests. No rubric move expected.

## Specific gap being closed

After Cycle 26, the prompt and wake script exist. But there's no way
to actually schedule the wake under launchd without a plist. This
cycle ships the generator. **CRITICAL: the script generates and
optionally `launchctl load`s; this cycle MUST NOT execute the
load against the real launchd** — that is the operator's one-shot
action after Phase B is complete.

## Change being made

1. Create `scripts/install_launchd_continuous.sh` — generates a plist
   for `com.lanston.autodev.continuous` per the kickoff doc spec:
   - `--install` → write plist + `launchctl load -w`
   - `--uninstall` → `launchctl unload -w` + delete plist
   - `--status` → list label + show stop conditions + Overall L
   - `--print-plist` (NEW, beyond kickoff spec) → write plist to
     stdout/file without touching launchctl. Enables test
     coverage without touching the real launchd.
   - Idempotent: `--install` unloads first if already loaded.
   - Env knobs (all overridable for tests):
     - `AUTODEV_REPO_ROOT` → repo path (default: script's
       parent-of-parent)
     - `AUTODEV_PLIST_PATH` → plist output path (default:
       `$HOME/Library/LaunchAgents/com.lanston.autodev.continuous.plist`)
     - `AUTODEV_INTERVAL_SECONDS` → StartInterval (default 900)
     - `AUTODEV_TARGET_L` → env var passed into plist (default 5)
     - `AUTODEV_LAUNCHD_DRY_RUN` → if set non-empty, skip all
       `launchctl` invocations. Tests use this.

2. Add `tests/test_install_launchd.py` — covers:
   - Script exists + executable
   - `--print-plist` emits a syntactically valid XML plist
   - The plist contains the required keys: Label,
     ProgramArguments, WorkingDirectory, EnvironmentVariables,
     StartInterval, StandardOutPath, StandardErrorPath,
     ThrottleInterval, RunAtLoad
   - `Label` matches the spec
   - `StartInterval` honors `AUTODEV_INTERVAL_SECONDS`
   - `RunAtLoad` is `<false/>` (no immediate fire on install)
   - `--install` with dry-run writes the plist file to the
     custom path (no launchctl call)
   - `--install` is idempotent (two installs leave one plist)
   - `--uninstall` with dry-run removes the plist file
   - `--status` exits 0 and prints something useful even when
     not installed
   - Unknown flag → exit 1 with usage

## Acceptance criteria

- [x] `scripts/install_launchd_continuous.sh` exists, executable
- [x] `tests/test_install_launchd.py` has ≥10 tests covering all
      flag branches + plist validity
- [x] `pytest tests/ -q` green
- [x] `compute_level.py --check` green (after propose-for-cycle)
- [x] `autodev_doctor.sh` exits 0 (still 12 checks)
- [x] The cycle does NOT actually load the plist into launchd

## Files to touch (closed set)

- `scripts/install_launchd_continuous.sh` (new)
- `tests/test_install_launchd.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark Cycle 27 done, surface Cycle 28 P0)
- `STATE.md` (rewrite)
- `cycles/20260513-051843/PLAN.md` (this file)
- `cycles/20260513-051843/REPORT.md`
- `cycles/20260513-051843/RESULT.md`
- `cycles/20260513-051843/next-track-proposal.json` (BEFORE --check)
- `reports/zero-deadlock-streak.txt` (bump 7→8)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0 scope.
- `$HOME/Library/LaunchAgents/` (DO NOT install).

## Rollback plan

`git reset --hard autoevo/pre-20260513-051843` is always the fallback.
This is pure-add; no risk to existing code.

## Risk score

low. Pure-add script + tests. The `AUTODEV_LAUNCHD_DRY_RUN` env var
ensures the test path doesn't touch the real launchd. The kickoff
doc explicitly tells us to leave the install for the operator.

## FAILURES.md pre-flight result

Keywords: launchd, plist, install, uninstall, status, idempotent.

- No FAILURES.md entries match these keywords.
- FAIL-0009 (doctor side-effect) is the known dirty-state issue; not
  relevant to this cycle's changes.

## Naming decision (deviation from kickoff doc)

The kickoff doc says "Cycle 27 — Build `scripts/install_launchd_autodev.sh`".
But that path **already exists** as v3 supervisor infrastructure with
LABEL=`com.autodev.supervisor`, ProgramArguments running
`scripts/autodev_supervisor.sh`. The L7 continuous-cycle installer is a
DIFFERENT agent (LABEL=`com.lanston.autodev.continuous`, runs
`scripts/autodev_continuous_cycle.sh`).

To avoid clobbering pre-existing v3 infrastructure, I'm shipping the
L7 installer at `scripts/install_launchd_continuous.sh` (named to
match its sibling `autodev_continuous_cycle.sh`). This is documented
in REPORT.md so the operator and Cycle 30's handoff doc cite the
correct path.

No L7 §0 hard constraint is violated by this rename — the kickoff
doc's spec is a description, not a binding name.

## Open questions / blockers

None.
