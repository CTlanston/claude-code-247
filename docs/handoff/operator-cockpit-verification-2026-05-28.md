# Operator Cockpit — Verification Handoff & Codex TODO (2026-05-28)

> Companion to `operator-cockpit-handoff-2026-05-28.md` (the implementation handoff).
> This file records the **independent verification result** and a **prioritized TODO for the codex agent**.

## 1. Summary

The Operator Cockpit was driven end-to-end against a freshly started `pnpm cockpit:dev`
(daemon :7247 + dashboard :7248). A docs-only mission was run from intake to the evidence gate.

**Verdict: PASS — genuinely runnable and observable, not a clickable shell.**

- Brainstorm and the worker both executed on the **real Codex CLI** (`FORCE_MOCK` unset,
  `runnerMode=codex-cli`, daemon PID env confirmed `PLANNER_PROVIDER=codex`).
- The mission stopped cleanly at the evidence gate: **no PR, no merge, isolated non-git workspace**.
- Focused tests **18/18 pass**; `pnpm typecheck` clean.

| Field | Value |
|---|---|
| Operator session | `01KSRDGE6HEVG2SF4V3D1GHW25` |
| Mission id | `01KSRDJT2T3YHATW85KCMVY3SJ` |
| Worker task / run | `01KSRDKM525FXB2EJ077EAZBGD` / `01KSRDKM53Q4EC2TF2RXEYX8JR` |
| Brainstorm provider | codex-cli (real, 31.5s, in 30746 / out 1448 tok, cost null) |
| Worker provider | codex-cli (real, 71.0s, in 190515 / out 3241 tok, cost null) |
| Approval | pending → approved |
| Run | done, exit 0 |
| Mission | paused (= WAITING / evidence gate) |
| Merge | WAITING — no auto-merge, no PR |
| Holds / errors | none |
| Evidence root | `~/.aedev/state/evidence/01KSRDJT2T3YHATW85KCMVY3SJ/` |

## 2. DONE (verified working)

- [x] **One-command startup** `pnpm cockpit:dev` — replaces stale repo-owned procs, starts daemon + Vite, verifies `/operator/sessions`.
- [x] **New Brainstorm = real AI** — Codex produced mission-specific multi-option analysis (recommendation + risks). Not the `renderBrainstorm` template, not a HOLD. 31.5s latency + recorded `provider:"codex-cli"`.
- [x] **HOLD-instead-of-fake is wired** — `runPlannerBrainstorm` returns `HOLD-PLANNER-CLI` / `HOLD-NO-LOCAL-CLI` (no synthetic substitution) when CLIs fail.
- [x] **Generate PRD** — creates mission, PRD/ADR/roadmap design artifacts, and a **pending approval** record.
- [x] **Approval Gate** — shows `pending` before approval; `Approve Roadmap` flips pending→approved and mission→approved.
- [x] **Start Execution** — async real Codex worker; returns immediately (`running`/`WAITING`); UI polls overview every 2s.
- [x] **Execution Monitor** — tasks, runs (`codex-cli: done (0)`), evidence dir all observable.
- [x] **Artifacts** — PRD, ADR (`adr-mission.md`), Roadmap (`roadmap.md`), Workbook summary, Worker transcript (real, 1187 chars), Model usage all present.
- [x] **Tokens/cost** — real token counts shown; `costUsd:null` rendered as explicit `unknown` (UI `costUsd ?? 'unknown'`).
- [x] **No merge to main** — decision WAITING; PR fields null; worker workspace is **non-git** (cannot push); main repo working tree untouched.
- [x] **Daemon APIs** — `/operator/sessions` and `/missions/:id/overview` both HTTP 200 with full payloads.
- [x] **Tests** — `vitest` codex-adapter (2) + server (10) + dashboard api (6) = **18/18**; `pnpm typecheck` exit 0.

## 3. NOT COMPLETED / GAPS (honest)

Product/behavior gaps:
- [ ] **PRD/ADR/Roadmap are deterministic templates, not AI** — `Generate PRD` returns in ~6ms from `LeadAgent.designMission`. Only brainstorm + worker are real AI. (Acceptance only required "visible content", so this PASSed — but it is not AI planning.)
- [ ] **ADR & Roadmap design artifacts point at the same `design.json`** — no standalone ADR doc at design time (standalone `adr-mission.md`/`roadmap.md` only appear at execution, also templated).
- [ ] **Worker "health" = PATH presence only** — `discoverWorkerSessions` sets `healthy:true` from `which`, with no auth probe. A *present-but-broken* CLI yields a **`failed` run, not a clean HOLD**. The handoff's "HOLD if unhealthy" promise holds only when the binary is **absent**.
- [ ] **Validators not wired** in the Cockpit path (`validatorCount:0`) — matches handoff known-limits.
- [ ] **`costUsd` is always `null` for Codex** (adapter hardcodes it) — cost is never knowable via Codex; only token counts.
- [ ] **No PR creation gate** after the evidence gate.
- [ ] **No streaming worker-log endpoint** — only the final transcript artifact.
- [ ] **No session persistence** across browser refresh.
- [ ] **Mission cost = worker-only** — brainstorm tokens are recorded on the *session* event, not aggregated into the mission overview cost.

Test/process gaps:
- [ ] **No Cockpit e2e test** that starts daemon + dashboard together.
- [ ] **UI verified at the API layer**, not via literal browser clicks. The React UI (`Cockpit.tsx`) is a confirmed thin client over the verified endpoints; dashboard serves at :7248. (Test-method gap, not a product gap.)

## 4. TODO for codex (prioritized)

> Constraints to honor (repo non-negotiables): validators see **evidence only**;
> `allow_remote_writes` defaults **false**; medium/high-risk merge, API fallback, and PR push
> all require **explicit approval**; **no silent API fallback**.

### P1 — Real session health probe (turns silent failures into visible HOLDs)
- **Files:** `packages/runner/src/worker-session-discovery.ts`, `packages/daemon/src/routes/operator.ts` (`operatorLocalCliRunner`).
- **Do:** replace PATH-only `healthy:true` with an actual probe (cheap `codex exec` no-op / `claude` auth check), or add a distinct `authed` flag; route to `HOLD-SESSION-POOL` when unhealthy/unauthed.
- **Acceptance:** point `AEDEV_CODEX_BIN` at a failing stub → `Start Execution` produces a visible HOLD (not an exit-nonzero `failed` run). Add a unit test covering the broken-but-present case.

### P2 — Wire validators (evidence-only) into the Cockpit path
- **Files:** `packages/daemon/src/routes/operator.ts` (`runOperatorMission` → pass `validators` to `MissionRunner`), `packages/validators/*`.
- **Do:** run Gemini/OpenAI validators on the evidence bundle only; gate on configured keys; if no keys, surface **"validators not configured"** explicitly (never silent-skip).
- **Acceptance:** `overview.validators` populated with verdicts; merge decision reflects validator input; missing keys → explicit note in overview.

### P3 — PR-creation gate after evidence (approval-gated, never auto-merge)
- **Files:** new `POST /operator/sessions/:id/create-pr` in `operator.ts`; reuse `ApprovalGate`; respect `system.allow_remote_writes` + repo `enabled`.
- **Do:** create a **draft PR only**, behind `allow_remote_writes=true` AND an approval record; never merge.
- **Acceptance:** writes disabled → blocked with reason; writes enabled + approved → draft PR URL on the mission; merge never triggered.

### P4 — Streaming worker-log endpoint
- **Files:** `operator.ts` (SSE or chunked `GET /missions/:id/runs/:runId/log`), `apps/dashboard/src/pages/Cockpit.tsx` (`ExecutionMonitor`).
- **Acceptance:** live transcript chunks visible while a run is `running`, not just the final artifact.

### P5 — Cockpit e2e test (deterministic)
- **Files:** `scripts/` + a vitest/e2e harness.
- **Do:** start daemon + dashboard, drive brainstorm→PRD→approve→start with `AEDEV_COCKPIT_FORCE_MOCK=1` for determinism; assert overview fields, artifact set, WAITING decision, zero PR.
- **Acceptance:** CI-runnable, no external CLI/auth dependency.

### P6 — Session persistence across refresh
- **Files:** `apps/dashboard/src/pages/Cockpit.tsx`, `apps/dashboard/src/api.ts` (+ optional daemon "latest session" endpoint).
- **Acceptance:** refreshing the browser keeps the active mission selected and polling.

### P7 — Cost aggregation + clarity (lower priority)
- **Files:** `operator.ts` (`summarizeCost`, brainstorm event scoping).
- **Do:** either aggregate session-scoped brainstorm tokens with worker tokens into the mission overview, or label the figure **"worker-only"**. Keep `costUsd` honest-unknown for Codex.
- **Acceptance:** overview cost is unambiguous about what it includes.

### P8 — (Product decision) AI-backed PRD/ADR/Roadmap
- **Files:** `packages/daemon/src/intake.ts`, `lead-agent.ts`, `operator.ts` (`/generate-roadmap`).
- **Note:** the deterministic template may be **intentional** (determinism/cost). Do **not** change without an explicit product call. If desired: have `generate-roadmap` call the planner to fill PRD/ADR/roadmap, then schema-validate.
- **Acceptance:** design artifacts contain mission-specific AI content that still passes `validateMissionDesign`.

## 5. How to reproduce this verification

```bash
pnpm cockpit:dev                       # daemon :7247 + dashboard :7248
# UI: http://localhost:7248  → New Brainstorm → Generate PRD → Approve Roadmap → Start Execution
curl http://localhost:7247/operator/sessions
curl http://localhost:7247/missions/<MISSION_ID>/overview
pnpm vitest run packages/runner/src/codex-adapter.test.ts packages/daemon/src/server.test.ts apps/dashboard/src/api.test.ts
pnpm typecheck
```
Strictness rule: do not credit fake/mock behavior unless `AEDEV_COCKPIT_FORCE_MOCK=1` is explicitly set and labeled. A genuine run shows `runnerMode=codex-cli` (or `claude-cli`), real token counts, and a real worker transcript referencing the isolated workspace.

## 6. Completion Addendum — P1-P8 closed by Codex (2026-05-28)

Status: **implemented and regression-tested**.

- [x] **P1 CLI Health Probe** — `discoverWorkerSessions` now probes present CLI binaries with short no-op executions. Broken-but-present Codex/Claude sessions are marked `healthy:false` with `probeStatus/probeError/probedAt`. Cockpit Start Execution routes that to `HOLD-SESSION-POOL` without creating a failed worker run.
- [x] **P8 AI-backed PRD/ADR/Roadmap** — `/operator/sessions/:id/generate-roadmap` calls the local planner CLI by default, extracts structured `MissionDesign` JSON, validates it with `validateMissionDesign`, and writes standalone `prd.md`, `adr.md`, `roadmap.md`, `task-dag.json`, and `design.json`. Deterministic templates are only used in `VITEST` or explicit `AEDEV_COCKPIT_FORCE_TEMPLATE=1`.
- [x] **P2 Validators** — Cockpit mission execution wires Gemini/OpenAI validators when keys are configured; validators read evidence only. Missing keys surface as `validatorStatus:"not_configured"` and do not count as a pass.
- [x] **P3 Draft PR Gate** — `POST /operator/sessions/:id/create-pr` exists, requires evidence gate + approval + enabled repo + `allow_remote_writes=true`, creates draft PR only through a gated adapter, and never merges. Disabled writes return a visible blocked state.
- [x] **P4 Live Worker Log** — worker runs write `operator-run.log`, emit `operator.worker_log` events from stdout/stderr chunks, register the log artifact, and expose `GET /missions/:id/runs/:runId/log`.
- [x] **P5 E2E Harness** — `pnpm test:cockpit:e2e` starts daemon + dashboard, drives the browser flow from New Brainstorm through evidence gate, and asserts `REMOTE_WRITES_DISABLED` blocks PR creation unless explicitly enabled.
- [x] **P6 Session Persistence** — dashboard stores active session id in `localStorage`, restores it on refresh, and falls back to `GET /operator/sessions?latest=1`.
- [x] **P7 Cost Aggregation** — mission overview aggregates planner + worker usage when available and labels the scope/cost honestly (`subscription_mode_usage`, cost unknown unless provider reports actual cost).

Validation run:

```bash
pnpm test
# 91 passed, 535 passed, 6 skipped

pnpm typecheck
# pass

pnpm --dir apps/dashboard build
# pass

pnpm test:cockpit:e2e
# Operator Cockpit deterministic e2e PASS

# Real local API smoke, FORCE_MOCK/FORCE_TEMPLATE unset:
# planner produced validated AI artifacts; codex-cli worker completed exit 0;
# mission paused at PR/Waiting/Blocked; no PR/merge; planner+worker tokens surfaced.
```

Current safety posture:

- Cockpit still stops at evidence gate / WAITING by default.
- Draft PR creation is implemented but blocked unless `allow_remote_writes=true` and an explicit adapter/config path is present.
- No automatic merge was added.
- Missing external validator keys produce a visible `not_configured` state instead of fake success.
