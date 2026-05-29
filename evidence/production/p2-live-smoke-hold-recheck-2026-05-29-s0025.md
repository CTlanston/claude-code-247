# P2 Live Smoke Hold Recheck - 2026-05-29

Session: `s_0025`
Stage: `P2_COCKPIT_DRAFT_PR_REAL_PATH`
Slice: `HOLD-P2-LIVE-SMOKE-GATE-AUTH` / `HOLD-LOCAL-DEPS-RESTORE`

## Scope

This run rechecked the open P2 live disposable-repo draft PR smoke blockers and
the local dependency-restore blocker. No product code was changed and no remote
write was attempted.

## Session Plan

- Acceptance criteria: confirm whether the remote-write gate/auth prerequisites
  changed, confirm whether local dependencies can be restored, run the strongest
  practical validation commands, and record updated handoff state.
- Expected files: this evidence file, `PRODUCTION_WORKBOOK.md`,
  `docs/handoff/production-handoff-latest.md`, `EXECUTION_WORKBOOK.md`, and the
  automation memory file.
- Verification commands: `CI=true pnpm install --offline --frozen-lockfile`,
  `bash scripts/doctor.sh`, `rg "child_process" packages/daemon/src`,
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
  `pnpm test:cockpit:p3-remote-smoke`.
- Rollback notes: documentation/evidence-only changes can be reverted by file
  if needed; no source code or runtime credentials were changed.
- HOLD conditions: missing `~/.Codex-247/config.yaml`, missing
  `~/.Codex-247/repos.yaml`, invalid `gh` auth, incomplete local pnpm store, or
  missing baseline CLI binaries.

## Gate/Auth Status

- `~/.Codex-247/config.yaml` - missing, so
  `system.allow_remote_writes=true` is not configured.
- `~/.Codex-247/repos.yaml` - missing, so no disposable smoke repo can be
  confirmed as `enabled: true`.
- `gh auth status` - failed for active account `CTlanston`; GitHub CLI reports
  the default token is invalid and requires re-authentication.
- `pnpm test:cockpit:p3-remote-smoke` - did not run as a valid live smoke
  because the explicit remote-write safety gate/auth prerequisites are still
  unavailable. A direct command attempt also failed before script execution
  because `tsx` is missing from local dependencies.

## Local Dependency Status

- `node_modules/.bin/eslint` - missing.
- `node_modules/.bin/tsc` - missing.
- `node_modules/.bin/vitest` - missing.
- `node_modules/.bin/tsx` - missing.
- `pnpm store path` - `/Users/lanston/projects/claude-code-247/.pnpm-store/v10`.
- `CI=true pnpm install --offline --frozen-lockfile` - FAIL; pnpm reported a
  missing offline tarball for `@eslint/js@9.39.4`.

## Local Validation

- `bash scripts/doctor.sh` - PASS required checks; daemon install/responding
  warnings only.
- `rg "child_process" packages/daemon/src` - PASS, no matches.
- `pnpm lint` - FAIL, `eslint: command not found`.
- `pnpm typecheck` - FAIL, `tsc: command not found`.
- `pnpm test` - FAIL, `vitest: command not found`.
- `pnpm test:cockpit:p3-remote-smoke` - FAIL before smoke execution,
  `tsx: command not found`.

## Decision

`HOLD-P2-LIVE-SMOKE-GATE-AUTH` remains open. `HOLD-LOCAL-DEPS-RESTORE` remains
open. The baseline gates cannot validate product behavior until dependencies
are restored with network access or a complete pnpm store, and P2 cannot finish
until the operator restores all remote-write prerequisites and the live smoke
proves branch push, draft PR creation, idempotent reuse, and no merge against a
disposable repo.

## Next Commands After Operator Fix

```sh
CI=true pnpm install --frozen-lockfile
bash scripts/doctor.sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:cockpit:p3-remote-smoke
```
