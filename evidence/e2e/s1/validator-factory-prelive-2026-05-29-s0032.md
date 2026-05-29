# E2E-1 pre-live evidence — default dual-validator factory

Session: `s_0032`
Timestamp: `2026-05-29T23:40:00Z`
Branch: `codex/v24-vertical-slice`
Slice: `E2E-1_REAL_LOOP_ADR_AND_PRECHECK`

## Scope

Implemented the local-safe default OpenAI + Gemini mission validator factory
and production constructor injection. This was mock-only and did not run live
OpenAI, Gemini, Docker, Claude, remote writes, or a target draft PR.

## Files Changed

- `packages/daemon/src/validator-factory.ts`
- `packages/daemon/src/validator-factory.test.ts`
- `packages/daemon/src/mission-runner.ts`
- `packages/daemon/src/mission-runner.test.ts`
- `packages/daemon/src/daemon.ts`
- `packages/daemon/src/server.ts`
- `packages/daemon/src/routes/operator.ts`
- `packages/daemon/src/index.ts`

## Acceptance

- Added `createDefaultMissionValidatorFactory()` and
  `buildDefaultMissionValidators()` for Gemini + OpenAI.
- Secret values resolve at task run time from the approved runtime secret path:
  wrapper-injected env or an injected `secretResolver` for secrets-mcp style
  integration.
- When `secretGrants` metadata is provided, a matching active, unexpired,
  task-scoped grant is required before a validator receives a key.
- Missing, revoked, expired, or wrong-task secrets produce no validator; they
  do not create fake passes.
- `MissionRunner` now supports `validatorFactory`, called after the task id is
  known, while tests can still inject explicit fake validators.
- Factory-backed MissionRunner construction hard-gates coder routing for
  dual-validator work.
- Production construction sites in `daemon.ts`, `server.ts`, and
  `routes/operator.ts` inject the default validator factory.
- Operator cockpit keeps surfacing `validatorStatus: "not_configured"` when no
  Gemini/OpenAI secrets are available.

## Validation

- `pnpm exec vitest run packages/daemon/src/validator-factory.test.ts packages/daemon/src/mission-runner.test.ts packages/daemon/src/server.test.ts`
  - PASS, 3 files, 39 tests.
- `pnpm typecheck`
  - PASS.
- `pnpm lint`
  - PASS.
- `bash scripts/doctor.sh`
  - PASS required checks; daemon install/responding warnings only.
- `pnpm test`
  - PASS, 95 files, 569 passed, 6 env-gated smoke skips.
- `rg "child_process" packages/daemon/src`
  - PASS, no matches.
- `git diff --check`
  - PASS.

## Explicitly Not Run

- No live OpenAI or Gemini validator token spend.
- No live Docker worker image was pulled or executed.
- No Claude CLI container auth attempt.
- No `allow_remote_writes` change.
- No target draft PR creation.
- No merge.

## Remaining E2E-1 Work

- Decide and provision the live Claude-capable Docker image and credential
  materialization path, or record `HOLD-CLAUDE-AUTH-IN-DOCKER` if container
  subscription auth is not viable.
- Run the operator-approved live E2E-1 loop only after explicit GO, then reset
  `allow_remote_writes=false`.
