# E2E-1 pre-live evidence — Claude Docker runner seam

Session: `s_0031`
Timestamp: `2026-05-29T23:12:42Z`
Branch: `codex/v24-vertical-slice`
Slice: `E2E-1_REAL_LOOP_ADR_AND_PRECHECK`

## Scope

Implemented the pre-live `claude-docker` runner seam from ADR-0019 without
running live Claude, Docker, OpenAI, Gemini, remote writes, or a target draft PR.

## Files Changed

- `.gitignore`
- `packages/core/src/schema.ts`
- `packages/runner/src/claude-docker-runner.ts`
- `packages/runner/src/claude-docker-runner.test.ts`
- `packages/runner/src/index.ts`
- `packages/runner/src/runner-manager.ts`
- `packages/runner/src/worker-pool-router.ts`
- `packages/runner/src/worker-pool-router.test.ts`
- `packages/daemon/src/mission-runner.ts`
- `packages/daemon/src/mission-runner.test.ts`

## Acceptance

- Added `RunnerMode = "claude-docker"` and `ProviderId = "claude-docker"`.
- Added `ClaudeDockerRunner` with injected Docker and credential hooks for
  mock-only tests.
- Runner requires an explicit `AEDEV_CLAUDE_DOCKER_IMAGE` or injected image.
- Runner fails with `HOLD-CLAUDE-AUTH-IN-DOCKER` when no materialized credential
  path is available.
- Docker argv uses `--rm -i`, mounts the worktree read-write, evidence
  read-write, and Claude credential read-only at
  `/root/.claude/.credentials.json`.
- Anthropic API fallback env vars are not passed into the container.
- Runner parses Claude JSON usage and writes `model-usage.json` with provider
  `claude-docker`.
- Worker routing prefers `claude-docker` for dual-validator coder work when a
  healthy docker session exists, and falls back to host `claude-cli` otherwise.
- Mission runner maps `claude-docker` to the Anthropic family and
  `local_claude_code` auth mode.
- `.pnpm-store/` is ignored after the offline dependency restore used the
  repo-local store.

## Validation

- `CI=true pnpm install --offline --frozen-lockfile` — PASS after copying the
  existing global pnpm store into the repo-local `.pnpm-store/`.
- `bash scripts/doctor.sh` — PASS required checks; daemon install/responding
  warnings only.
- `pnpm exec vitest run packages/runner/src/claude-docker-runner.test.ts packages/runner/src/worker-pool-router.test.ts packages/daemon/src/mission-runner.test.ts`
  — PASS, 3 files, 31 tests.
- `pnpm typecheck` — PASS.
- `pnpm lint` — PASS.
- `pnpm test` — PASS, 94 files, 564 passed, 6 env-gated smoke skips.
- `rg "child_process" packages/daemon/src` — PASS, no matches.

## Explicitly Not Run

- No live Docker worker image was pulled or executed.
- No Claude/OpenAI/Gemini live token spend.
- No `allow_remote_writes` change.
- No target draft PR creation.
- No merge.

## Remaining E2E-1 Work

- Wire the default production validator factory for OpenAI + Gemini through the
  approved secrets path.
- Decide and provision the live Claude-capable Docker image and credential
  materialization path, or record `HOLD-CLAUDE-AUTH-IN-DOCKER` if container
  subscription auth is not viable.
- Run the operator-approved live E2E-1 loop only after explicit GO, then reset
  `allow_remote_writes=false`.
