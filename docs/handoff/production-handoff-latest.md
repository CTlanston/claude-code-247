# Production Handoff Latest

Date: 2026-05-29T23:12:42Z
Session: s_0031
Canonical repo: `/Users/lanston/projects/claude-code-247`
Branch: `codex/v24-vertical-slice`
Head: pending local commit for `[E2E-1] claude-docker runner seam; accept 8/8`
Workbook: [PRODUCTION_WORKBOOK.md](../../PRODUCTION_WORKBOOK.md)
Design ADR: [ADR-0018](../adr/0018-production-hardening-loop.md)
E2E ADR: [ADR-0019](../adr/0019-real-e2e-loop-docker-claude-dual-family.md)

## Current State

- The v24 repository remains the only Claude Code 247 production-hardening
  target.
- E2E-1 is in pre-live implementation.
- ADR-0019 exists; `model_usage` persistence was already present at session
  start in local commit `6f0488a`.
- `s_0031` added the mock-tested `claude-docker` runner seam, route/provider
  support, and mission-runner Anthropic family/auth mapping.
- The outward live run remains gated on explicit operator GO.

## Latest Changes

- Added `packages/runner/src/claude-docker-runner.ts`.
- Added `RunnerMode` / `ProviderId` support for `claude-docker`.
- `RunnerManager` can construct `ClaudeDockerRunner`.
- `WorkerPoolRouter` prefers `claude-docker` for dual-validator coder work when
  a healthy docker session exists, and falls back to host `claude-cli`.
- `MissionRunner` maps `claude-docker` to Anthropic family and
  `local_claude_code` auth mode.
- Added tests for runner HOLD gates, Docker argv, read-only credential mount,
  API env stripping, evidence/model usage output, route preference, and mission
  family mapping.
- Added `.pnpm-store/` to `.gitignore` after offline dependency restore used a
  repo-local store.

## Blockers

- No open holds.
- Live E2E-1 still needs an operator GO before any outward run, remote-write
  gate change, live token spend, or target draft PR.
- Live Dockerized Claude still needs a Claude-capable image and credential
  materialization path. If subscription auth cannot work inside the container,
  record `HOLD-CLAUDE-AUTH-IN-DOCKER`; do not silently switch to API fallback.

## Validation

- `CI=true pnpm install --offline --frozen-lockfile` - PASS.
- `bash scripts/doctor.sh` - PASS required checks; daemon install/responding
  warnings only.
- `pnpm exec vitest run packages/runner/src/claude-docker-runner.test.ts packages/runner/src/worker-pool-router.test.ts packages/daemon/src/mission-runner.test.ts`
  - PASS, 3 files, 31 tests.
- `pnpm typecheck` - PASS.
- `pnpm lint` - PASS.
- `pnpm test` - PASS, 94 files, 564 passed, 6 env-gated smoke skips.
- `rg "child_process" packages/daemon/src` - PASS, no matches.

## Evidence

- `evidence/e2e/s1/claude-docker-runner-prelive-2026-05-29-s0031.md`
- Prior E2E-0 evidence remains under `evidence/e2e/s0-unblock/`.

## Next Action

Continue E2E-1 with the next local-safe slice: wire the default OpenAI+Gemini
validator factory and production constructor injection through the approved
secrets path. Do not run the live outward path, open a target draft PR, spend
live validator tokens, or enable remote writes until explicit operator GO.
