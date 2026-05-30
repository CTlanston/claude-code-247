# Restore Execution Plan

## Assumptions

- The target host is the local launchd daemon host for `claude-code-247`.
- The current branch is `shadow/issue-247` so code and evidence changes do not land on `main` directly.
- The smoke harness must run in `real` mode and must not use `--synthetic`.

## Done Check

- `pnpm -F @aedev/daemon typecheck`
- `pnpm vitest run packages/daemon/src/server.test.ts packages/core/src/launch-smoke-real.test.ts`
- `pnpm tsx scripts/launch-smoke.ts` exits 0 with `LAUNCH_AUTHORIZED`, `mode: real`, and evidence in `evidence/launch/smoke-*.{json,md}`.

## Steps

1. Add the missing daemon smoke endpoints required by the real smoke harness.
2. Bind the CLI operator callbacks so checks 3 and 6 wait for observable daemon events instead of throwing immediately.
3. Restart the launchd daemon, verify endpoints, then run the real smoke.
4. Continue s5-s7 only after the real smoke evidence passes the contract.
