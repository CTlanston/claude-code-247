# Production Handoff Latest

Date: 2026-05-30T01:06:52Z
Session: s_0035
Canonical repo: `/Users/lanston/projects/claude-code-247`
Branch: `codex/v24-vertical-slice`
Head: local commit `[E2E-1] claude-docker preflight; accept 8/8`
Workbook: [PRODUCTION_WORKBOOK.md](../../PRODUCTION_WORKBOOK.md)
Design ADR: [ADR-0018](../adr/0018-production-hardening-loop.md)
E2E ADR: [ADR-0019](../adr/0019-real-e2e-loop-docker-claude-dual-family.md)

## Current State

- The v24 repository remains the only Claude Code 247 production-hardening
  target.
- E2E-1 is in pre-live implementation and is currently held at the live
  checkpoint.
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
- `s_0034` recorded `HOLD-CLAUDE-AUTH-IN-DOCKER`; `s_0035` rechecked the live
  checkpoint and the blocker remains because this run lacks explicit operator
  GO, `AEDEV_CLAUDE_DOCKER_IMAGE`, and a readable
  `AEDEV_CLAUDE_CREDENTIAL_FILE`. GitHub CLI auth for `CTlanston` is still
  invalid.

## Latest Changes

- Added evidence file
  `evidence/e2e/s1/live-checkpoint-hold-recheck-2026-05-30-s0035.md`.
- Updated `PRODUCTION_WORKBOOK.md` and `EXECUTION_WORKBOOK.md` to show
  `open_holds: 1`, `blocked_on: HOLD-CLAUDE-AUTH-IN-DOCKER`, the latest
  `s_0035` recheck, and the exact operator-owned next action.
- Updated this latest handoff to point at the live checkpoint hold recheck.
- Preserved prior local hold evidence and the pre-existing untracked raw
  evidence logs:
  `evidence/e2e/s1/live-checkpoint-hold-2026-05-30-s0034.md`,
  `evidence/e2e/s1/test.log` and `evidence/e2e/s1/typecheck.log`.

## Blockers

- `HOLD-CLAUDE-AUTH-IN-DOCKER` is open.
- Live E2E-1 still needs explicit operator GO before any outward run,
  remote-write gate change, live token spend, target draft PR, branch push, or
  merge.
- `AEDEV_CLAUDE_DOCKER_IMAGE` is absent.
- `AEDEV_CLAUDE_CREDENTIAL_FILE` is absent.
- `gh auth status -h github.com` fails because the active `CTlanston` token is
  invalid.
- `system.allow_remote_writes` remains `false`, as required until an approved
  one-run live E2E-1 attempt.
- Target repo `multi-agent-brainstorm` remains registered and `enabled: true`;
  `auto_merge.enabled` remains `false`.

## Validation

- `bash scripts/doctor.sh`
  - PASS required checks; daemon install/responding warnings only.
- `pnpm lint`
  - PASS.
- `pnpm typecheck`
  - PASS.
- `pnpm test`
  - PASS, 95 files, 574 passed, 6 env-gated smoke skips.
- `rg "child_process" packages/daemon/src`
  - PASS, no matches.
- `git diff --check`
  - PASS.

## Evidence

- `evidence/e2e/s1/live-checkpoint-hold-recheck-2026-05-30-s0035.md`
- `evidence/e2e/s1/live-checkpoint-hold-2026-05-30-s0034.md`
- `evidence/e2e/s1/claude-docker-preflight-2026-05-30-s0033.md`
- `evidence/e2e/s1/validator-factory-prelive-2026-05-29-s0032.md`
- `evidence/e2e/s1/claude-docker-runner-prelive-2026-05-29-s0031.md`
- Prior E2E-0 evidence remains under `evidence/e2e/s0-unblock/`.

## Next Action

Do not run the live outward path, open a target draft PR, spend live tokens, or
enable remote writes until the operator provides explicit GO. To continue E2E-1,
the operator must provide `AEDEV_CLAUDE_DOCKER_IMAGE`, a readable
`AEDEV_CLAUDE_CREDENTIAL_FILE`, repaired `gh` auth for `CTlanston`, and explicit
one-run authorization to enable remote writes. After any approved live run,
reset `allow_remote_writes=false`. If container subscription auth cannot be
safely materialized, keep `HOLD-CLAUDE-AUTH-IN-DOCKER` open and do not silently
fall back to an API path.
