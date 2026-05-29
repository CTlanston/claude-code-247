# Operator Cockpit Handoff — 2026-05-28

## What This Feature Is

Operator Cockpit is the local web entrypoint for running a Claude Code 24/7 mission from idea intake to an evidence gate.

Local URL:

```bash
http://localhost:7248
```

One-command dev startup:

```bash
pnpm cockpit:dev
```

The startup script replaces stale repo-owned dev processes on ports 7247 and 7248, starts the current TypeScript daemon, starts the Vite dashboard, and verifies:

```bash
http://localhost:7247/operator/sessions
```

## User Flow Now Implemented

1. Enter a repo, title, and brainstorm prompt.
2. Click `New Brainstorm`.
   - In development, the daemon attempts a real local CLI planner call.
   - Default planner provider for `pnpm cockpit:dev` is Codex CLI.
   - If local CLI fails, the conversation shows a visible `HOLD-*` message instead of substituting fake brainstorm text.
3. Click `Generate PRD`.
   - Creates mission design artifacts.
   - Creates a pending approval record.
   - The UI shows PRD/ADR/roadmap artifacts and previews.
4. Review `Approval Gate`.
5. Click `Approve Roadmap`.
   - Converts the pending approval into approved state.
6. Click `Start Execution`.
   - In real dev mode, starts an async local CLI worker through the daemon.
   - In Vitest only, uses a deterministic draft runner for stable tests.
   - The UI keeps polling `/missions/:id/overview` every 2 seconds.
7. Watch `Execution Monitor`, tasks, runs, events, evidence, and token/cost fields.

## Important Environment Flags

```bash
AEDEV_COCKPIT_PLANNER_PROVIDER=codex|claude
AEDEV_COCKPIT_AI_TIMEOUT_MS=120000
AEDEV_COCKPIT_WORKER_TIMEOUT_MS=180000
AEDEV_COCKPIT_FORCE_MOCK=1
```

Notes:

- `AEDEV_COCKPIT_FORCE_MOCK=1` is only for explicit fake/demo fallback.
- Without that flag, execution attempts a real local `codex` or `claude` CLI worker.
- If neither local CLI is healthy, the mission should enter a visible HOLD path.

## Files Touched

- `apps/dashboard/src/pages/Cockpit.tsx`
- `apps/dashboard/src/api.ts`
- `apps/dashboard/src/hooks/useSSE.ts`
- `apps/dashboard/index.html`
- `packages/daemon/src/routes/operator.ts`
- `packages/daemon/src/server.ts`
- `packages/core/src/migrations.ts`
- `packages/core/src/db.ts`
- `packages/core/src/schema.ts`
- `packages/runner/src/codex-adapter.ts`
- `scripts/dev-operator-cockpit.ts`

## Current Verified Behavior

Automated browser smoke with current local CLI:

- `New Brainstorm` returned real Codex planner content.
- `Generate PRD` returned HTTP 200 and created PRD/ADR/roadmap artifacts.
- Pending approval was visible before approval.
- `Approve Roadmap` returned HTTP 200.
- `Start Execution` returned HTTP 200 immediately and the UI kept polling.
- `Execution Monitor` showed worker/run state.
- Token/cost fields remain explicit: real token values if provider reports them, otherwise `unknown`.

## Known Limits

- The worker uses an isolated temporary workspace under `~/.aedev/state/operator-workspaces/<task>`.
- It does not push to GitHub.
- It does not merge to `main`.
- Validators are still not wired by default for the Cockpit route; validator results remain empty unless validators are configured in the mission runner path.
- The planner can still HOLD if local Claude/Codex auth is broken or slow.
- PR creation remains outside this Cockpit demo path.

## Verification Commands

```bash
pnpm vitest run packages/runner/src/codex-adapter.test.ts packages/daemon/src/server.test.ts apps/dashboard/src/api.test.ts
pnpm typecheck
pnpm test
pnpm --dir apps/dashboard build
```

Expected as of this handoff:

- Route/API focused tests pass.
- Typecheck passes.
- Full test suite passes.
- Dashboard production build passes.

## Next Hardening Steps

1. Persist selected/latest operator session so browser refresh keeps the active mission.
2. Add validator configuration UI and wire Gemini/OpenAI validators against evidence only.
3. Add a PR creation gate after evidence validation.
4. Add a run log endpoint for streaming worker transcript chunks instead of only final transcript artifacts.
5. Add a Cockpit-specific e2e test that starts the daemon and dashboard together.
