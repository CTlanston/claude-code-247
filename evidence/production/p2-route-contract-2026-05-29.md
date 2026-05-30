# P2 Route Contract Evidence — 2026-05-29

Session: `s_0012`
Stage: `P2_COCKPIT_DRAFT_PR_REAL_PATH`

## Scope

This run implemented and verified the Operator Cockpit draft-PR route contract:

- production daemon route no longer has an `AEDEV_COCKPIT_FAKE_PR` success path;
- `POST /operator/sessions/:id/create-pr` no longer returns `example.invalid`;
- `REMOTE_WRITES_DISABLED` short-circuits before the injected executor is called;
- enabled remote writes with no executor returns `DRAFT_PR_EXECUTOR_UNAVAILABLE`;
- unavailable executor records `HOLD-DRAFT-PR-EXECUTOR`;
- injected side-effect executor can return/reuse a draft PR without daemon-owned
  `git`/`gh` subprocess code.

## Validation

- `bash scripts/doctor.sh` — PASS
- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm vitest run packages/daemon/src/server.test.ts packages/daemon/src/draft-pr-gate.test.ts packages/daemon/src/remote-write-gh.test.ts` — PASS, 27 passed
- `pnpm test` — PASS, 93 files, 553 passed, 6 skipped
- `rg child_process packages/daemon/src` — PASS, no matches
- `rg "AEDEV_COCKPIT_FAKE_PR|example\\.invalid|DRAFT_PR_NOT_CONFIGURED" packages/daemon/src` — PASS for production source; only negative test assertions mention `example.invalid`

## Remaining P2 Evidence

Run the live disposable-repo smoke only when remote-write gate/auth are
explicitly available:

```sh
pnpm test:cockpit:p3-remote-smoke
```

Acceptance requires branch push, draft PR creation, idempotent reuse, and no
merge.
