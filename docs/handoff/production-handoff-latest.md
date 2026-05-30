# Production Handoff Latest

Date: 2026-05-30T00:09:30Z
Session: s_0033
Canonical repo: `/Users/lanston/projects/claude-code-247`
Branch: `codex/v24-vertical-slice`
Head: local commit `[E2E-1] claude-docker preflight; accept 8/8`
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
- `s_0033` added the local-safe Claude Docker static/runtime preflight,
  credential materialization checks, credential path redaction, and runner
  exports for future operator/CLI readiness checks.
- The outward live run remains gated on explicit operator GO.

## Latest Changes

- Added `preflightClaudeDockerEnvironment()` in `packages/runner/src/claude-docker-runner.ts`.
- Added `ClaudeDockerRunner.preflightRuntime()` for a Docker probe that verifies
  a supplied image exposes `claude` and can read the read-only credential mount.
- The runner now applies static preflight before attempting credential
  materialization or Docker execution.
- Missing image returns `HOLD-CLAUDE-DOCKER-IMAGE`; missing/unreadable
  credential materialization returns `HOLD-CLAUDE-AUTH-IN-DOCKER`.
- Preflight output intentionally omits credential source paths and secret
  values; runtime probe failures redact the credential host path.
- Exported the preflight helper and types from `@aedev/runner`.

## Blockers

- No open holds recorded in the workbook.
- Live E2E-1 still needs an operator GO before any outward run, remote-write
  gate change, live token spend, or target draft PR.
- The current environment does not provide `AEDEV_CLAUDE_DOCKER_IMAGE` or
  `AEDEV_CLAUDE_CREDENTIAL_FILE`; Docker and host `claude` binaries are present.
- Next operator decision: provide a Claude-capable Docker image plus a readable
  materialized Claude credential file, or accept `HOLD-CLAUDE-AUTH-IN-DOCKER`
  if subscription auth cannot be safely materialized for the container.

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

## Evidence

- `evidence/e2e/s1/claude-docker-preflight-2026-05-30-s0033.md`
- `evidence/e2e/s1/validator-factory-prelive-2026-05-29-s0032.md`
- `evidence/e2e/s1/claude-docker-runner-prelive-2026-05-29-s0031.md`
- Prior E2E-0 evidence remains under `evidence/e2e/s0-unblock/`.

## Next Action

Continue E2E-1 only after the operator provides explicit GO plus
`AEDEV_CLAUDE_DOCKER_IMAGE` and a readable `AEDEV_CLAUDE_CREDENTIAL_FILE`, or
record `HOLD-CLAUDE-AUTH-IN-DOCKER` if subscription auth cannot be safely
materialized for Docker. Do not run the live outward path, open a target draft
PR, spend live tokens, or enable remote writes until explicit operator GO; reset
`allow_remote_writes=false` after any approved live run.
