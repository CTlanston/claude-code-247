# ADR-0011: `install_launchd_continuous.sh` is byte-idempotent and dry-run previewable

## Context

The L7 24/7 supervisor's launchd installer
(`scripts/install_launchd_continuous.sh`) is the only authority
for the on-disk plist at
`~/Library/LaunchAgents/com.lanston.autodev.continuous.plist`.
Operators reinstall the agent when:

- A cycle changes the plist generation logic (see Cycle β →
  PATH auto-discovery, HOME, no `$HOME` literals — ADR-0010).
- A new launchd interval or termination target is wanted
  (`AUTODEV_INTERVAL_SECONDS`, `AUTODEV_TARGET_L`).
- The discovered `claude` binary moved (npx cache hash rotation,
  pnpm version bump, manual `npm install -g` redo).

Two failure modes existed prior to Cycle β + γ:

1. **Out-of-band patches drifted.** Operators manually edited the
   live plist via PlistBuddy / Cursor to add `HOME` and the npx
   cache to PATH; the install script didn't reproduce those edits,
   so any reinstall regressed. ADR-0010 closed this by codifying
   the patches into the install script.

2. **Re-running `--install` was a leap of faith.** The script
   would unload, write, and load — operators had no way to see
   what they were about to install. The only options were
   `--print-plist` (pure XML, no destination context) or
   `--install` (commits to the plist + launchctl side effects
   atomically).

This ADR captures the four pillars that make the post-Cycle β + γ
install script **safe to re-run without thinking**.

## Decision

**`scripts/install_launchd_continuous.sh` is byte-idempotent under
identical inputs, dry-run previewable before commitment, and has
no time-of-install dependencies in the plist body.**

The four pillars:

1. **Path auto-discovery is deterministic given the operator's
   PATH at install time.** `command -v claude` resolves through
   `readlink -f`; `mdfind` fallback returns the first
   `node_modules/.bin/claude` match deterministically (sorted by
   relevance score, but stable across mtime-equal entries).
   `AUTODEV_CLAUDE_BIN_DIR` is the test/operator override hook
   used to force a specific path.

2. **All paths in the emitted plist are absolute.** `HOME` is
   embedded as the resolved value (default `$HOME` at install
   time; overridable via `AUTODEV_HOME`); `PATH` is composed from
   absolute components only. The plist body contains no
   `$HOME` / `${HOME}` literal — launchd does NOT expand env-var
   references inside plist strings, so a literal would silently
   break runtime path resolution.

3. **No time-of-install state in the plist body.** No timestamps,
   no random IDs, no `$$`-style PIDs. This is what makes the
   `test_install_is_idempotent` regression test (and the new
   `test_dry_run_idempotent_byte_identical`) viable: two `--install`
   invocations 100ms apart produce byte-identical files. Future
   changes to the plist generator MUST preserve this property.

4. **`--dry-run` is the operator's pre-commit gate.** New in
   Cycle γ: prints the target plist path, the launchctl commands
   `--install` would invoke, and the plist body itself — all to
   stdout, never touching disk or calling launchctl. Operators
   should run `--dry-run` before every `--install` until muscle
   memory says otherwise.

The CLI surface is now:

| Flag            | Side effect                          | Use case                          |
|-----------------|--------------------------------------|-----------------------------------|
| `--install`     | Write plist + `launchctl load -w`    | Commit to installation            |
| `--uninstall`   | `launchctl unload -w` + remove file  | Roll back                         |
| `--status`      | None (read-only)                     | Check what's live                 |
| `--print-plist` | None (pure stdout, XML only)         | Test harnesses, piping into files |
| `--dry-run`     | None (pure stdout, simulation)       | Pre-install operator review       |

`--print-plist` is the lower-level affordance for test harnesses
(byte-identical to what `--install` writes); `--dry-run` is the
human-facing simulation (with the simulation preamble naming the
target path and launchctl commands).

## Consequences

### Good
- Operators can rerun `--install` after any cycle without
  worrying about drift.
- New cycles that change plist generation get caught by
  `test_install_is_idempotent` (same input → same output) and
  `test_dry_run_idempotent_byte_identical` (excluding the
  timestamp header that `--dry-run` adds to its preamble).
- The four pillars are now grep-discoverable for future cycles
  via this ADR + the linked regression tests.

### Bad
- Cycles that legitimately want time/identity in the plist
  (e.g., debugging via embedded version strings) will fail the
  idempotence test and must either bypass it deliberately or
  inject the version string outside the plist body.
- `--dry-run` and `--print-plist` overlap (both emit the plist).
  The split is intentional (different audiences: operators vs
  test harnesses) but adds a small amount of dispatcher surface
  area.

## Alternatives Rejected

1. **One subcommand for both `--print-plist` and `--dry-run`.**
   Rejected: tests want pure XML on stdout for parsing; operators
   want the simulation preamble. A flag toggle (`--print-plist
   --verbose`) was considered but rejected as less discoverable.
2. **Stamp the plist body with `<key>InstallTime</key>` etc.**
   for debugging. Rejected: breaks idempotence (each `--install`
   would produce different bytes), and operators rarely need that
   info (the file's `mtime` already records install time).
3. **Make `--install` auto-prompt for confirmation.** Rejected:
   operators sometimes script the install in setup playbooks;
   prompting breaks automation. `--dry-run` is the affordance
   for "look before you leap"; `--install` stays unconditional.

## Linked regression tests

- `tests/test_install_launchd_continuous.py::test_install_is_idempotent`
- `tests/test_install_launchd_continuous.py::test_dry_run_exits_zero_and_writes_no_file`
- `tests/test_install_launchd_continuous.py::test_dry_run_includes_target_path`
- `tests/test_install_launchd_continuous.py::test_dry_run_includes_plist_body`
- `tests/test_install_launchd_continuous.py::test_dry_run_plist_body_is_valid_plist`
- `tests/test_install_launchd_continuous.py::test_dry_run_does_not_invoke_launchctl`
- `tests/test_install_launchd_continuous.py::test_dry_run_idempotent_byte_identical`
- `tests/test_install_launchd_continuous.py::test_no_unexpanded_home_variable`
  (Cycle β; the no-literal-`$HOME` pillar)

## Linked ADRs

- [ADR-0010](0010-launchd-auth-via-env-var.md) — Cycle β; codifies
  PATH auto-discovery + HOME embedding + .env token routing.
  ADR-0011 builds on it by canonicalizing the idempotence
  + dry-run properties.

## Linked cycle

Cycle γ (CYCLE_ID `20260514-170538`), branch
`autoevo/cycle-gamma/install-idempotent-dry-run`.
