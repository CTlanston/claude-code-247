# Production Handoff Latest

Date: 2026-05-29T22:07:56Z
Session: s_0028
Canonical repo: `/Users/lanston/projects/claude-code-247`
Branch: `codex/v24-vertical-slice`
Workbook: [PRODUCTION_WORKBOOK.md](../../PRODUCTION_WORKBOOK.md)
Design ADR: [ADR-0018](../adr/0018-production-hardening-loop.md)

## Current State

- The v24 repository is the only Claude Code 247 production-hardening target.
- Current slice is E2E-0 hold clearing: restore local dependencies, restore
  remote-write config/registry, and repair GitHub auth before any product code.
- Active automations remain consolidated to the main Claude Code 247 hardening
  loop and the CommentPilot guard.
- Existing P0/P1/P2/P4 dirty work from prior runs is preserved; do not make a
  mixed commit across workbook slices.

## Latest Changes

- `HOLD-LOCAL-DEPS-RESTORE` was rechecked and remains open.
- `HOLD-P2-LIVE-SMOKE-GATE-AUTH` was rechecked and remains open.
- No product code was changed in `s_0028`; no branch push, draft PR creation,
  merge, or other remote write was attempted.
- The latest known full green baseline remains `s_0016`; `s_0028` could not
  rerun the baseline because local dependencies remain incomplete.
- P2 route contract remains implemented for
  `POST /operator/sessions/:id/create-pr`.
- E2E-0 remains blocked by dependency and operator-auth prerequisites.

## Blockers

- `~/.Codex-247/config.yaml` is missing, so
  `system.allow_remote_writes=true` is not configured.
- `~/.Codex-247/repos.yaml` is missing, so no target repo can be confirmed as
  `enabled: true`.
- `gh auth status` reports the active `CTlanston` token is invalid and requires
  re-authentication.
- Local `eslint`, `tsc`, `vitest`, and `tsx` binaries are missing.
- `CI=true pnpm install --offline --frozen-lockfile` is blocked by a missing
  offline tarball for `eslint@9.39.4`.
- `CI=true pnpm install --frozen-lockfile` is blocked by restricted sandbox
  network/DNS (`ENOTFOUND registry.npmjs.org`).

## Validation

- `CI=true pnpm install --offline --frozen-lockfile` - FAIL, missing offline
  tarball for `eslint@9.39.4`.
- `CI=true pnpm install --frozen-lockfile` - FAIL, cannot resolve
  `registry.npmjs.org`; first fatal fetch was `eslint@9.39.4`.
- `bash scripts/doctor.sh` - PASS required checks; warns daemon not
  installed/responding. Note: doctor reports dependencies installed despite
  missing local tool binaries.
- Boundary check: `rg "child_process" packages/daemon/src` - PASS, no matches.
- `pnpm lint` - FAIL, `eslint: command not found`.
- `pnpm typecheck` - FAIL, `tsc: command not found`.
- `pnpm test` - FAIL, `vitest: command not found`.
- `test -f ~/.Codex-247/config.yaml` - FAIL, missing.
- `test -f ~/.Codex-247/repos.yaml` - FAIL, missing.
- `gh auth status` - FAIL, active `CTlanston` token invalid.
- `pnpm test:cockpit:p3-remote-smoke` - FAIL before smoke execution,
  `tsx: command not found`; also blocked by remote-write gate/auth.

## Evidence

- `evidence/launch/roadmap-agent-rollup-2026-05-29.md`
- `evidence/production/p2-route-contract-2026-05-29.md`
- `evidence/production/p2-live-smoke-blocked-2026-05-29.md`
- `evidence/production/approval-v2-tamper-hold-resolved-2026-05-29.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0015.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0016.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0017.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0018.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0019.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0020.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0021.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0022.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0023.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0024.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0025.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0026.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0027.md`
- `evidence/e2e/s0-unblock/hold-recheck-2026-05-29-s0028.md`

## Next Action

First restore local dependencies with network access or a complete pnpm store,
then rerun `bash scripts/doctor.sh`, `pnpm lint`, `pnpm typecheck`, and
`pnpm test`. Operator also needs to repair the remote-write prerequisites:
create/restore `~/.Codex-247/config.yaml`, create/restore
`~/.Codex-247/repos.yaml` with the target repo `enabled: true`, and refresh
`gh` auth for `github.com`. Then run `pnpm test:cockpit:p3-remote-smoke`,
verify draft PR creation/reuse, confirm no merge, and record evidence.
