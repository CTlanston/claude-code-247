# Cycle 20260514-170538 PLAN — Cycle γ (install idempotence + --dry-run)

## Target dimension
**S — Safety gates**, code-path strengthening (operator-facing
`--dry-run` for the launchd install reduces blind-install risk; ADR-0011
canonicalizes the path-discovery + idempotence decisions Cycle β
introduced so future cycles can cite them).

## Specific gap being closed
Cycle β codified the previously-out-of-band PATH + HOME patches into
`scripts/install_launchd_continuous.sh`, but operators reinstalling
have no way to **preview** the plist the script would write without
either invoking `--print-plist` (which dumps XML only — no destination
path / launchctl context) or running `--install` (which actually
writes to disk and calls launchctl). A safer affordance is needed
before the operator's post-session reload step.

In addition, the install script has implicit idempotence (existing
test `test_install_is_idempotent` confirms two `--install` calls
produce byte-identical plists) but the decision to depend on that
is undocumented — ADR-0011 codifies it so future cycles know
not to add timestamps or random IDs into the plist body.

## Change being made
Two-prong, smallest vertical slice:

1. `scripts/install_launchd_continuous.sh` — add a `--dry-run`
   subcommand that prints (a) the target plist path, (b) the
   launchctl commands `--install` would execute, and (c) the plist
   XML itself, all to stdout, never touching disk or launchctl.
   Existing `--print-plist` stays as the pure XML-only emitter
   (lower-level affordance for test harnesses); `--dry-run` is
   the operator-facing simulation.

2. `docs/adr/0011-launchd-install-idempotence.md` — documents the
   four pillars that make the install script safe to re-run:
   path auto-discovery (Cycle β), absolute paths (no `$HOME`
   literals), no time/identity injection (no embedded timestamps
   or random IDs in plist body), and dry-run preview. Links to
   the existing regression tests + Cycle β's ADR-0010.

Plus 3-4 regression tests for `--dry-run`.

## Acceptance criteria
- [ ] `--dry-run` exits 0, prints non-empty stdout, never writes a
      file, never calls launchctl.
- [ ] `--dry-run` output includes the plist XML body (greppable for
      `<key>Label</key>` AND `com.lanston.autodev.continuous`).
- [ ] `--dry-run` output includes the target plist path (greppable
      for the value of `AUTODEV_PLIST_PATH`).
- [ ] At least one test extracts the plist substring from `--dry-run`
      output and asserts `plutil -lint` accepts it (Darwin only).
- [ ] `pytest -q` green (no regression in any existing test).
- [ ] `scripts/compute_level.py --check` exit 0.
- [ ] `scripts/autodev_doctor.sh` exit 0.

## Files to touch (closed set)
- `scripts/install_launchd_continuous.sh` (extend)
- `tests/test_install_launchd_continuous.py` (extend with ≥3 tests)
- `docs/adr/0011-launchd-install-idempotence.md` (new)
- `cycles/20260514-170538/{PLAN,RESULT,REPORT,STATE.before,next-track-proposal}.md`
- `CHANGELOG.md`, `STATE.md`, `reports/zero-deadlock-streak.txt`,
  `reports/cycle-history.jsonl` (RECORD step)

## Files forbidden to touch
- `.env*`, `secrets/**`, `LEVEL.md`, `FAILURES.md`, append-only ADRs
  0000-0010, the live plist at
  `~/Library/LaunchAgents/com.lanston.autodev.continuous.plist`,
  `scripts/autodev_continuous_cycle.sh` (out of scope for γ —
  γ is install-only)

## Rollback plan
`git reset --hard autoevo/pre-20260514-170538`

## Risk score
**low.** New subcommand; no behavior change to existing
`--install` / `--uninstall` / `--print-plist` / `--status`
branches. The `--dry-run` flag is additive.

## FAILURES.md pre-flight result
`grep -nE 'dry-run|idempotent|install_launchd|preview' FAILURES.md`
→ 0 hits. Novel territory.

## Open questions / blockers
None.
