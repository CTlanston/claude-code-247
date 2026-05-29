# P2 Live Smoke Precheck Blocked — 2026-05-29

Session: `s_0013`
Stage: `P2_COCKPIT_DRAFT_PR_REAL_PATH`

## Scope

This run attempted the required precheck for the remaining P2 live
disposable-repo draft PR smoke. The smoke itself was not run because the
remote-write safety prerequisites were not present.

## Precheck Results

- `~/.Codex-247/config.yaml` — missing, so `system.allow_remote_writes=true`
  is not configured.
- `~/.Codex-247/repos.yaml` — missing, so the target disposable repo cannot be
  confirmed as `enabled: true` in the registry.
- `gh auth status` — failed for active account `CTlanston`; GitHub CLI reports
  the default token is invalid and requires re-authentication.

## Local Validation

- `bash scripts/doctor.sh` — PASS required checks; warned that the daemon is
  not installed/responding.
- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm vitest run packages/daemon/src/server.test.ts packages/daemon/src/draft-pr-gate.test.ts packages/daemon/src/remote-write-gh.test.ts` — PASS,
  27 tests passed.
- `pnpm test` — FAIL outside this P2 slice:
  `packages/approval-v2/src/approval-v2.test.ts` case 2 expected tampered
  token verification to fail, but `verifier.verify(...)` returned `ok=true`.

## Decision

P2 remains open. The live smoke must wait until all required gates are
explicitly available:

1. `system.allow_remote_writes=true` in the operator-controlled config.
2. Disposable smoke repo present and `enabled: true` in the repo registry.
3. Valid `gh` authentication for `github.com`.

No branch push, PR creation, merge, or other remote write was attempted.

The full baseline suite also remains blocked by the unrelated `approval-v2`
tamper-token regression. Do not mark P2 accepted until both the remote smoke
and baseline suite pass.

## Next Command After Operator Fix

```sh
pnpm test:cockpit:p3-remote-smoke
```

Acceptance still requires branch push, draft PR creation, idempotent reuse, and
confirmation that no merge occurred.
