# Cycle 20260513-051843 Report — Phase B Cycle 27 (launchd installer)

## Verdict

PASS — infrastructure cycle. `scripts/install_launchd_continuous.sh`
generates and (optionally) installs the launchd plist for the L7
continuous-cycle agent. 26 regression tests cover every flag branch
+ every plist key + idempotency + the L7-vs-v3 label distinction.

## Level changes

None. C streak bumped 7→8.

## Change

1. **`scripts/install_launchd_continuous.sh`** (new, executable):
   The L7 launchd plist installer. Distinct from the pre-existing v3
   `install_launchd_autodev.sh` (which manages
   `com.autodev.supervisor`). This one manages
   `com.lanston.autodev.continuous`, running
   `scripts/autodev_continuous_cycle.sh` every
   `${AUTODEV_INTERVAL_SECONDS:-900}` seconds.

   Flags:
   - `--install` → write plist + `launchctl load -w`. Idempotent
     (unloads first, then loads).
   - `--uninstall` → unload + delete plist. Idempotent (no-ops if
     plist absent).
   - `--status` → human-readable: plist path + existence, launchd
     registration, stop-condition presence (AUTODEV_DONE / STOPSWITCH
     / BLOCKED / quota-rate-limit-until), and current Overall L.
   - `--print-plist` → emit plist XML to stdout. Pure function, no
     side effects, no `launchctl` calls. Used by tests to validate
     plist structure.
   - `--help` / `-h` → usage; exit 0.
   - Bare invocation → usage to stderr, exit 1.
   - Unknown flag → "Unknown flag" to stderr, exit 1.

   Env overrides (all optional; defaults sensible):
   - `AUTODEV_REPO_ROOT` — repo path (default: script's parent of
     parent, so it works regardless of cwd).
   - `AUTODEV_PLIST_PATH` — plist file location (default
     `$HOME/Library/LaunchAgents/<LABEL>.plist`).
   - `AUTODEV_INTERVAL_SECONDS` — StartInterval (default 900).
   - `AUTODEV_TARGET_L` — termination target (default 5).
   - `AUTODEV_LAUNCHD_PATH` — PATH inside the plist's
     EnvironmentVariables (default includes both Homebrew prefixes
     + system + pnpm).
   - `AUTODEV_LAUNCHD_DRY_RUN` — if non-empty, skip all `launchctl`
     invocations. Tests use this; operators don't.

   Plist contents (all 9 required keys):
   - `Label`, `ProgramArguments`, `WorkingDirectory`,
     `EnvironmentVariables`, `StartInterval`, `StandardOutPath`,
     `StandardErrorPath`, `ThrottleInterval` (60s),
     `RunAtLoad` (false — no immediate fire on install; first wake
     comes after StartInterval).

2. **`tests/test_install_launchd_continuous.py`** (new, 26 tests):
   - Existence + executable (2)
   - `--print-plist` parses via `plistlib`; all 9 required keys
     present; `ProgramArguments[1]` ends with
     `/scripts/autodev_continuous_cycle.sh` (3)
   - StartInterval default 900 + honors `AUTODEV_INTERVAL_SECONDS`
     env (2)
   - `AUTODEV_TARGET_L` default 5 + honors env (2)
   - `RunAtLoad=False`, `ThrottleInterval=60`,
     `WorkingDirectory=$REPO`, log paths inside repo (4)
   - `--install` writes plist; is idempotent (same bytes on second
     install); dry-run skips launchctl (3)
   - `--uninstall` removes plist; is idempotent when not installed (2)
   - `--status` works when not installed; works when installed;
     surfaces STOPSWITCH; surfaces Overall L (4)
   - Unknown flag exits non-zero; bare invocation exits 1; `--help`
     exits 0 (3)
   - **L7-vs-v3 label distinction**: Label MUST be
     `com.lanston.autodev.continuous`, NOT `com.autodev.supervisor`
     (1)

## Naming deviation

The kickoff doc spec named this file `scripts/install_launchd_autodev.sh`,
but that path already exists as v3 supervisor infrastructure
(LABEL `com.autodev.supervisor`, runs `autodev_supervisor.sh`).
Clobbering it would have broken the v3 supervisor agent.

The L7 installer ships at `scripts/install_launchd_continuous.sh`
instead. The two agents are independent:
- v3 supervisor (`com.autodev.supervisor`) is unchanged.
- L7 continuous (`com.lanston.autodev.continuous`) is new this
  cycle.

Both can be loaded into launchd simultaneously. The L7 agent is what
the operator will activate after Phase B is complete. The Cycle 30
handoff doc cites the correct path.

## Files modified

```
scripts/install_launchd_continuous.sh          (new, executable)
tests/test_install_launchd_continuous.py       (new, 26 tests)
CHANGELOG.md, BACKLOG.md, STATE.md
reports/zero-deadlock-streak.txt               (7→8)
reports/cycle-history.jsonl                    (+ entry)
cycles/20260513-051843/*
```

## Verify

- `pytest tests/ -q`: 438 passed, 2 skipped, 0 failed (+26 this cycle)
- `propose_next_track --for-cycle 20260513-051843` → proposal artifact
  written FIRST per Cycle 25 ordering rule
- `compute_level --check` (post-proposal): passed (Overall L=4 stable)
- `autodev_doctor.sh`: 12 passed, 0 failed, 2 warned
- Manual smoke: `AUTODEV_LAUNCHD_DRY_RUN=1 bash scripts/install_launchd_continuous.sh --print-plist | python3 -c "import sys, plistlib; plistlib.loads(sys.stdin.buffer.read())"` parses cleanly with all 9 required keys.

## Constraints honored

- No `git push`. No PR merge. No secret touch. None applicable.
- The script does NOT auto-install. Tests always use
  `AUTODEV_LAUNCHD_DRY_RUN=1`. The operator runs `--install` once.
- Pre-existing v3 infrastructure (`install_launchd_autodev.sh`) is
  untouched.
- 45-min budget: ~12 minutes for this cycle.

## Next

**Phase B Cycle 28**: `scripts/autodev_status_dashboard.sh` — read-only
operator dashboard. Shows Overall L, per-dim table, C streak progress,
last 5 cycles, stop conditions, and `launchctl list | grep autodev`
for both the L7 and v3 agents.

## Wall clock

~12 minutes.
