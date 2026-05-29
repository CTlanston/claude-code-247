# Production Handoff Latest

Date: 2026-05-29T23:40:00Z
Session: s_0032
Canonical repo: `/Users/lanston/projects/claude-code-247`
Branch: `codex/v24-vertical-slice`
Head: pending local commit for `[E2E-1] default validator factory; accept 8/8`
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
- `s_0032` added the default OpenAI+Gemini validator factory, task-time runtime
  secret resolution, optional active grant enforcement, and production
  constructor injection.
- The outward live run remains gated on explicit operator GO.

## Latest Changes

- Added `packages/daemon/src/validator-factory.ts`.
- `createDefaultMissionValidatorFactory()` builds real Gemini + OpenAI
  validators from wrapper-injected runtime secrets or an injected
  secrets-mcp-style resolver.
- When grant metadata is supplied, the factory requires active, unexpired,
  task-scoped grants before passing a key into a validator constructor.
- `MissionRunner` now accepts `validatorFactory`, calls it after a task id
  exists, and treats factory-backed runs as dual-validator hard-gated work.
- `daemon.ts`, `server.ts`, and `routes/operator.ts` inject the default factory
  in production construction paths.
- Operator cockpit still emits `operator.validators_not_configured` and
  surfaces `validatorStatus: "not_configured"` when Gemini/OpenAI secrets are
  absent.

## Blockers

- No open holds.
- Live E2E-1 still needs an operator GO before any outward run, remote-write
  gate change, live token spend, or target draft PR.
- Live Dockerized Claude still needs a Claude-capable image and credential
  materialization path. If subscription auth cannot work inside the container,
  record `HOLD-CLAUDE-AUTH-IN-DOCKER`; do not silently switch to API fallback.

## Validation

- `bash scripts/doctor.sh` - PASS required checks; daemon install/responding
  warnings only.
- `pnpm exec vitest run packages/daemon/src/validator-factory.test.ts packages/daemon/src/mission-runner.test.ts packages/daemon/src/server.test.ts`
  - PASS, 3 files, 39 tests.
- `pnpm typecheck` - PASS.
- `pnpm lint` - PASS.
- `pnpm test` - PASS, 95 files, 569 passed, 6 env-gated smoke skips.
- `rg "child_process" packages/daemon/src` - PASS, no matches.
- `git diff --check` - PASS.

## Evidence

- `evidence/e2e/s1/validator-factory-prelive-2026-05-29-s0032.md`
- `evidence/e2e/s1/claude-docker-runner-prelive-2026-05-29-s0031.md`
- Prior E2E-0 evidence remains under `evidence/e2e/s0-unblock/`.

## Next Action

Continue E2E-1 with the next local-safe slice: resolve the live Claude Docker
image and credential materialization path, or record `HOLD-CLAUDE-AUTH-IN-DOCKER`
if subscription auth cannot work inside the container. Do not run the live
outward path, open a target draft PR, spend live tokens, or enable remote writes
until explicit operator GO.
