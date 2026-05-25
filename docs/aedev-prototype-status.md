# aedev TypeScript Prototype — Status

> **This document is the authoritative record of what the TypeScript `aedev`
> prototype has completed, what is still a placeholder, and what must be
> finished before TypeScript can replace the Python production system.**
>
> Updated: 2026-05-25

---

## Production vs. Prototype

| System | Status | Quick start |
|--------|--------|-------------|
| Python `claude247` | **GA (v1.0.0)** | `make install && claude247 doctor` |
| TypeScript `aedev` | **Experimental prototype** | `pnpm install && aedev init` |

---

## What is implemented and tested

| Component | File(s) | Tests passing |
|-----------|---------|---------------|
| Schema / types | `packages/core/src/schema.ts` | ✅ |
| SQLite migrations (v1 + v2) | `packages/core/src/migrations.ts` | ✅ |
| `AedevDb` — all CRUD operations | `packages/core/src/db.ts` | ✅ |
| State machine (task + mission) | `packages/core/src/state-machine.ts` | ✅ |
| `ExperimentalFeatureError` typed class | `packages/core/src/errors.ts` | ✅ |
| Repo registry + Zod validation | `packages/core/src/repo-registry.ts` | ✅ |
| ULID generator | `packages/core/src/ids.ts` | ✅ |
| Risk scorer (additive 0–100) | `packages/validators/src/risk-scorer.ts` | ✅ |
| Merge policy (strict dual-validator) | `packages/validators/src/merge-policy.ts` | ✅ |
| Evidence reviewer | `packages/validators/src/reviewer.ts` | ✅ |
| Mock validator | `packages/validators/src/mock-validator.ts` | ✅ |
| Evidence writer | `packages/runner/src/evidence.ts` | ✅ |
| Mock runner | `packages/runner/src/mock-runner.ts` | ✅ |
| Runner manager | `packages/runner/src/runner-manager.ts` | ✅ |
| Worktree manager (git commands) | `packages/runner/src/worktree.ts` | ✅ (unit only) |
| Heartbeat service | `packages/daemon/src/heartbeat.ts` | ✅ |
| Approval gate | `packages/daemon/src/approval.ts` | ✅ |
| Intake service (two-step approval) | `packages/daemon/src/intake.ts` | ✅ |
| Fastify daemon + all routes | `packages/daemon/src/server.ts` | ✅ |
| SSE `/events/stream` | `packages/daemon/src/routes/sse.ts` | ✅ |
| Memory compiler + injector | `packages/daemon/src/memory/` | ✅ |
| CLI scaffold (commander) | `packages/cli/src/` | ✅ (smoke) |
| GitHub PR + issue + check stubs | `packages/github/src/` | ✅ (unit) |
| Vite + React dashboard (build) | `apps/dashboard/` | ✅ (build) |

---

## What is a placeholder (throws `ExperimentalFeatureError` or returns stub)

| Component | Current behaviour | Required for production |
|-----------|-------------------|------------------------|
| `DockerRunner.run()` | Throws `ExperimentalFeatureError` | Real Docker container launch + tty capture |
| `ClaudeCodeAdapter.run()` | Throws `ExperimentalFeatureError` | Real `claude` subprocess invocation |
| `GeminiValidator` | Returns `inconclusive` | Real Gemini 2.5 Pro API call + structured verdict |
| `OpenAIValidator` | Returns `inconclusive` | Real OpenAI-compatible API call + structured verdict |
| `WorktreeManager` wiring | Not connected to `RunnerManager` | `RunnerManager` must create/clean worktrees |
| `LeadAgent.generatePrdTemplate()` | Returns static markdown template | Optional: real Claude call for PRD generation |
| GitHub sync (`/github/sync`) | Creates PR via Octokit (real API) | Requires `AEDEV_GITHUB_TOKEN` set |
| `aedev github import-issue` | Imports issue via Octokit (real API) | Requires `AEDEV_GITHUB_TOKEN` set |

---

## What must be completed before TypeScript can replace Python

All nine verification gates below must turn green in a single end-to-end
smoke run before the migration PR may be opened.

| # | Gate | Status |
|---|------|--------|
| 1 | `pnpm install` exits 0 | ✅ |
| 2 | `pnpm test` — all unit tests pass | ✅ |
| 3 | `pnpm typecheck` — zero type errors | ✅ |
| 4 | `pnpm lint` — zero lint errors | ✅ |
| 5 | Docker worker real smoke: `DockerRunner.run()` completes a real task | ❌ not implemented |
| 6 | Claude Code adapter real smoke: `ClaudeCodeAdapter.run()` executes a prompt | ❌ not implemented |
| 7 | Dual-validator smoke: Gemini + OpenAI both return real verdicts for a sample diff | ❌ not implemented |
| 8 | GitHub PR dry-run: `aedev github sync` creates a draft PR without merging | ❌ requires token |
| 9 | Human approval gate: no mission can execute without `requestApproval()` + explicit `approveMission()` | ✅ enforced by tests |

Gates 1–4 and 9 are currently passing.  Gates 5–8 are not.

---

## Invariants that must remain true forever (enforced by tests)

1. **No auto-merge without dual validators.** `MergePolicy.decide()` never
   returns `AUTO_MERGE` if `validatorResults.length < 2`, if any result is
   `fail`, or if any result is `inconclusive`.

2. **No self-approval.** `IntakeService.approveMission()` throws if no
   pending approval record exists (i.e. `requestApproval()` was never called).
   Creating and approving in the same call is not possible.

3. **Placeholder runners throw typed errors.** `DockerRunner.run()` and
   `ClaudeCodeAdapter.run()` throw `ExperimentalFeatureError` (never generic
   `Error`) so callers and tests can assert on the class.

4. **Secret pattern guard.** `AedevDb.insertMemoryItem()` throws if content
   contains `PASSWORD=`, `TOKEN=`, `SECRET=`, or `API_KEY=`.

5. **State machine rejects invalid transitions.** `validateTaskTransition()`
   and `validateMissionTransition()` throw on invalid status transitions.

---

## Migration checklist (when all 9 gates are green)

- [ ] Open migration PR titled `feat(prod): promote TypeScript aedev to production`
- [ ] PR is reviewed under medium-risk policy (human approval required)
- [ ] Python `claude247` CLI is deprecated with a redirect message
- [ ] `make install` is updated to install `aedev` alongside or instead of `claude247`
- [ ] README quick start switches to `aedev` commands
- [ ] ADR-0008 status updated to "superseded by migration PR"
- [ ] This document updated to "✅ completed — see migration PR"
