# E2E-1 pre-live evidence — Claude Docker preflight

Session: `s_0033`
Timestamp: `2026-05-30T00:09:30Z`
Branch: `codex/v24-vertical-slice`
Slice: `E2E-1_REAL_LOOP_ADR_AND_PRECHECK`

## Scope

Implemented the local-safe Claude Docker readiness checkpoint. This run did not
run live Docker with real Claude credentials, pull a live image, spend
Claude/OpenAI/Gemini tokens, mutate `allow_remote_writes`, create a target draft
PR, or merge.

## Files Changed

- `packages/runner/src/claude-docker-runner.ts`
- `packages/runner/src/claude-docker-runner.test.ts`
- `packages/runner/src/index.ts`

## Acceptance

- Added `preflightClaudeDockerEnvironment()` to classify the live prerequisites:
  explicit `AEDEV_CLAUDE_DOCKER_IMAGE`, explicit credential materialization
  through `AEDEV_CLAUDE_CREDENTIAL_FILE` or an injected provider, and detected
  Anthropic API fallback env vars.
- Added `ClaudeDockerRunner.preflightRuntime()` to materialize the credential,
  run an injected or real Docker probe, and confirm the image exposes `claude`
  and can read the credential mount.
- Missing image returns `HOLD-CLAUDE-DOCKER-IMAGE`.
- Missing or unreadable credential materialization returns
  `HOLD-CLAUDE-AUTH-IN-DOCKER`.
- Preflight output intentionally omits credential file paths and secret values.
- Runtime probe failures redact the credential host path from surfaced errors.
- The existing runner path now uses the same static preflight before attempting
  credential materialization or Docker execution.
- Runner exports include the preflight helper and types for future operator or
  CLI readiness checks.

## Validation

- `pnpm exec vitest run packages/runner/src/claude-docker-runner.test.ts`
  - PASS, 1 file, 10 tests.
- `bash scripts/doctor.sh`
  - PASS required checks; daemon install/responding warnings only.
- `pnpm typecheck`
  - PASS.
- `pnpm lint`
  - PASS.
- `pnpm test`
  - PASS, 95 files, 574 passed, 6 env-gated smoke skips.
- `rg "child_process" packages/daemon/src`
  - PASS, no matches.
- `git diff --check`
  - PASS.

## Explicitly Not Run

- No live Docker image pull or live Docker probe with real Claude credentials.
- No Claude/OpenAI/Gemini live token spend.
- No keychain read/export attempt.
- No `allow_remote_writes` change.
- No target draft PR creation.
- No merge.

## Result

The local-safe live path is now explicit and test-covered: a future operator
GO must provide a Claude-capable Docker image and a readable materialized Claude
credential file, or the runner returns the appropriate HOLD instead of falling
back to mock/API behavior.

Current environment probe, without printing secret values:

- `AEDEV_CLAUDE_DOCKER_IMAGE`: absent
- `AEDEV_CLAUDE_CREDENTIAL_FILE`: absent
- `docker` binary: present
- host `claude` binary: present

## Remaining E2E-1 Work

- Operator must decide whether to provide `AEDEV_CLAUDE_DOCKER_IMAGE` plus a
  readable `AEDEV_CLAUDE_CREDENTIAL_FILE`, or accept
  `HOLD-CLAUDE-AUTH-IN-DOCKER` if subscription auth cannot be safely
  materialized for the container.
- Only after explicit operator GO: run the live E2E-1 loop on
  `CTlanston/multi-agent-brainstorm`, then reset `allow_remote_writes=false`.
