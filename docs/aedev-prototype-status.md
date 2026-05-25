# aedev TypeScript Runtime — Parity Status Against the Python `claude247` Kernel

> Authoritative record of TypeScript runtime parity against the Python
> `claude247` execution kernel.  Per
> [ADR-0009](adr/0009-aedev-as-primary-control-plane.md), `aedev` is the
> primary control plane and Python `claude247` is the compatibility
> execution kernel during the parity window.  This document tracks the
> gates the TypeScript runtime must clear before the bridge can be retired.
>
> Updated: 2026-05-25

---

## Dual-kernel architecture

| Layer | Implementation | Role |
|-------|---------------|------|
| **Control plane** | TypeScript `aedev` (pnpm monorepo) | Primary entry point — CLI, Fastify daemon, dashboard, state machine, mission flow, approvals, memory, risk policy, evidence bundle. |
| **Execution kernel** | Python `claude247` v1.0.0 GA | Mature Docker worker runtime, headless `claude --print`, Gemini + OpenAI judges, GitHub PR creation.  Invoked by `aedev` during the parity window. |
| **Bridge** | `@aedev/claude247-bridge` | Subprocess interop with `claude247` CLI: `Claude247Bridge.enqueue/listTasks/getTask/readEvidence` + `Claude247BridgeRunner` (implements `RunnerInterface`).  Selectable via `RunnerConfig.mode === 'claude247-bridge'`. |

---

## What the TypeScript control plane implements natively

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

## What currently delegates to the Python kernel via the bridge

| Component | TypeScript status | Delegates to | Bridge gate |
|-----------|-------------------|--------------|-------------|
| `DockerRunner.run()` | Real container launch with mounts + timeout + evidence capture (Phase 2 landed) | Production worker logic still routed to Python `runner/worker.py` via bridge | Gate 5 / Gate 10 |
| `ClaudeCodeAdapter.run()` | Real `claude --print` subprocess (Phase 2 landed) | Mirrors Python `runner/claude_cli.py` shape | Gate 6 |
| `GeminiValidator` | Stub (returns `inconclusive`) | Python `validator/gemini_judge.py` for production verdicts | Gate 7 |
| `OpenAIValidator` | Stub (returns `inconclusive`) | Python `validator/openai_judge.py` | Gate 7 |
| GitHub sync (`aedev github sync`) | Real Octokit calls (requires `AEDEV_GITHUB_TOKEN`) | Python `orchestrator/github_client.py` for parity scenarios | Gate 8 |
| Mission → worker dispatch | Routed via `@aedev/claude247-bridge` | Python orchestrator dispatch loop | Gate 10 |

---

## Parity gates

All ten gates below must turn green before the bridge can be retired.  Per
ADR-0009, the bridge remains in tree for one full minor-version cycle after
parity as a rollback path.

| # | Gate | Status |
|---|------|--------|
| 1 | `pnpm install` exits 0 | ✅ |
| 2 | `pnpm test` — all unit tests pass | ✅ |
| 3 | `pnpm typecheck` — zero type errors | ✅ |
| 4 | `pnpm lint` — zero lint errors | ✅ |
| 5 | `DockerRunner.run()` executes a real container, captures stdout/stderr/exit-code, enforces timeout, writes evidence | ✅ landed (Phase 2) |
| 6 | `ClaudeCodeAdapter.run()` invokes `claude --print` via stdin, parses JSON, strips API key in subscription mode | ✅ landed (Phase 2) |
| 7 | `GeminiValidator` and `OpenAIValidator` return real verdicts for a sample evidence bundle | ❌ not implemented |
| 8 | `aedev github sync` creates a real draft PR against a test repo | ⏳ requires `AEDEV_GITHUB_TOKEN` to verify |
| 9 | Approval gate enforced: no mission executes without `requestApproval()` + distinct `approveMission()` | ✅ enforced by tests |
| 10 | `@aedev/claude247-bridge` routes an `aedev` mission through the Python kernel and surfaces evidence in `aedev`'s SQLite | ✅ landed (Phase 3) |

Gates 1–6, 9, 10 are passing.  Gates 7 (real validators) and 8 (real GitHub PR) are downstream — they are now reachable via the bridge for missions that need Python-side execution.

**Phase 2 verification (unit + opt-in smoke):**

```bash
pnpm test                # unit tests, all green — uses fake binaries in temp dir
AEDEV_SMOKE_CLAUDE=1 pnpm test --filter @aedev/runner   # real `claude --print` round-trip
AEDEV_SMOKE_DOCKER=1 pnpm test --filter @aedev/runner   # real container against alpine:3.20
pnpm test:smoke          # both smoke groups at once
```

---

## Invariants that must remain true forever (enforced by tests)

1. **No auto-merge without dual real validators.**  `MergePolicy.decide()`
   never returns `AUTO_MERGE` if `validatorResults.length < 2`, if any result
   is `fail`, or if any result is `inconclusive`.  Stub validators count as
   `inconclusive`.

2. **No self-approval.**  `IntakeService.approveMission()` throws if no
   pending approval record exists (i.e. `requestApproval()` was never
   called).  Creating and approving in the same call is not possible.

3. **Typed `ExperimentalFeatureError`.**  The class survives as a marker for
   *unconfigured optional adapters* (e.g. a runner that is not selected by
   the active runner mode).  It must not be thrown on a configured happy
   path.

4. **Secret pattern guard.**  `AedevDb.insertMemoryItem()` throws if content
   contains `PASSWORD=`, `TOKEN=`, `SECRET=`, or `API_KEY=`.

5. **State machine rejects invalid transitions.**  `validateTaskTransition()`
   and `validateMissionTransition()` throw on invalid status transitions.

6. **Sensitive lane stays sensitive.**  Auth, payment, security, and
   deployment changes require stronger tests, dual validator PASS, preview
   evidence, rollback plan, and no secret-scan hits — even when the bridge
   delegates the actual execution to the Python kernel.

---

## Bridge retirement criteria

When all ten gates above are green, open a dedicated ADR to retire
`@aedev/claude247-bridge`.  Retirement is itself a medium-risk change
requiring human approval.  Even after retirement, Python `claude247`
remains in tree as the historical v1.0.0 GA release; it is not deleted.
