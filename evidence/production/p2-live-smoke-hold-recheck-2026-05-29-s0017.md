# P2 Live Smoke Hold Recheck — 2026-05-29

Session: `s_0017`
Stage: `P2_COCKPIT_DRAFT_PR_REAL_PATH`
Slice: `HOLD-P2-LIVE-SMOKE-GATE-AUTH`

## Scope

This run rechecked the remaining P2 live disposable-repo draft PR smoke
prerequisites. No product code was changed and no remote write was attempted.

## Gate/Auth Status

- `~/.Codex-247/config.yaml` — missing, so
  `system.allow_remote_writes=true` is not configured.
- `~/.Codex-247/repos.yaml` — missing, so no disposable smoke repo can be
  confirmed as `enabled: true`.
- `gh auth status` — failed for active account `CTlanston`; GitHub CLI reports
  the default token is invalid and requires re-authentication.
- `pnpm test:cockpit:p3-remote-smoke` — did not run as a valid live smoke
  because the explicit remote-write safety gate/auth prerequisites are still
  unavailable. A direct command attempt also failed before script execution
  because `tsx` is currently missing from local dependencies.

## Local Validation

- `pnpm install --frozen-lockfile` — FAIL in non-TTY mode before doing useful
  validation (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`).
- `CI=true pnpm install --frozen-lockfile` — FAIL after recreating
  `node_modules`; network is restricted and package fetches from
  `registry.npmjs.org` failed with `ENOTFOUND`.
- `CI=true pnpm install --offline --frozen-lockfile` — FAIL; pnpm store is
  missing `eslint-9.39.4.tgz`, so the workspace cannot relink tooling offline.
- `bash scripts/doctor.sh` — PASS required checks; daemon install/responding
  warnings only.
- `rg "child_process" packages/daemon/src` — PASS, no matches.
- `pnpm lint` — FAIL, `eslint: command not found`.
- `pnpm typecheck` — FAIL, `tsc: command not found`.
- `pnpm test` — FAIL, `vitest: command not found`.
- `pnpm test:cockpit:p3-remote-smoke` — FAIL before smoke execution,
  `tsx: command not found`.

## Decision

`HOLD-P2-LIVE-SMOKE-GATE-AUTH` remains open. This run also leaves a local
validation environment blocker: dependencies must be restored with network
access or a complete pnpm store before baseline gates can be trusted again.

P2 cannot be accepted until the operator restores all required remote-write
prerequisites and the live smoke proves branch push, draft PR creation,
idempotent reuse, and no merge against a disposable repo.

## Next Commands After Operator Fix

```sh
CI=true pnpm install --frozen-lockfile
bash scripts/doctor.sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:cockpit:p3-remote-smoke
```
