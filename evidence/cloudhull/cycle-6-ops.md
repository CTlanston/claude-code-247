# CloudHull Cycle 6 — single "Operations" view for the owner

Date: 2026-06-11 · Branch: `claude/cloudhull-alpha`

## What shipped

1. **Daemon `GET /ops/overview`** (`packages/daemon/src/routes/ops.ts`,
   registered in `server.ts`) — read-only, no auth, derived ENTIRELY from
   events/holds/config. **Zero LLM calls, zero subprocess spawns (GR#8)** —
   probing `claude` is itself a metered headless call, so engine health is
   inferred from RECENT recorded events only (limit 500, newest signal wins).
   - `activeHolds`: code + humanized text via the `user-state.ts`
     `explainBlockingCode` mapping + createdAt.
   - `activeMissions`: id/title/status/submittedBy (non-terminal missions;
     submittedBy from the newest linked operator session, `'owner'` backfill).
   - `lastValidator`: { status, verdict, atIso } from the latest
     `operator.validator_result` / `operator.validators_not_configured` event.
   - `remoteWrites`: { enabled, whitelist } via `remote-write-policy.ts`
     (env wins, config fallback, fail-closed).
   - `engines`: claude/codex/gemini ∈ unknown|ready|needs_login|not_configured.
     `operator.hold_created` with `HOLD-PLANNER-AUTH` → claude `needs_login`
     (until a newer resolution or successful metered call); successful
     `cost.headless_call` per provider → `ready`; gemini key env presence →
     `ready`, else `not_configured`. Never spawns probes.
   - `suggestedRecovery`: plain-language actions; claude needs_login emits the
     exact sentence `Claude planner needs login on this Mac · 在这台 Mac 上运行
     claude login`; other active holds reuse their humanized text; missing
     gemini key emits a configure-review action.

2. **Dashboard "Ops" tab** (`apps/dashboard/src/pages/Ops.tsx`, tab wired in
   `App.tsx`, `api.getOpsOverview` in `api.ts`) — strictly read-only (no
   buttons/inputs/forms), humanized text only; machine codes live exclusively
   in `data-*` attributes (`data-code`, `data-engine-status`, `data-status`,
   `data-remote-writes`). Recovery section emphasized first.
   `data-testid="ops-page"`, `data-testid="ops-recovery"`.

## TDD

- `[cloudhull-c6] test:` commit first — both test files failing
  (`Cannot find module './ops.js'`), then `[cloudhull-c6] feat:`.
- New tests: 10 daemon route tests (`packages/daemon/src/routes/ops.test.ts`)
  + 4 component tests (`apps/dashboard/src/pages/Ops.test.tsx`), covering:
  empty state shape; injected HOLD-PLANNER-AUTH event → `engines.claude =
  'needs_login'` + exact recovery sentence + humanized hold text; remote
  writes mirror env; lastValidator from validator events (latest wins);
  active missions with submittedBy + owner backfill; engines from events/env
  only; no raw machine codes visible in the UI; read-only page; calm empty
  state.

## Gates

| gate | result |
|---|---|
| `pnpm typecheck` | PASS (all packages) |
| `pnpm lint` | PASS |
| `GIT_CONFIG_GLOBAL=/tmp/test-gitconfig pnpm test` | **1036 passed, 6 skipped, 0 failed** (baseline 1022 + 14 new, zero regressions) |
