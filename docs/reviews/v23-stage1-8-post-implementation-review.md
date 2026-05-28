# v2.3 Stage 1-8 Post-Implementation Review

**Date:** 2026-05-28
**Branch:** `codex/v23-acceptance-harness`
**PR:** #12

This review is intentionally strict. The previous Stage 1-8 pass proved that
the branch had real code, CI, and real Claude/Codex smoke evidence. It did not
prove every original v2.3 ambition was production-complete. This file separates
runtime-complete pieces from verifiable scaffolding and names the next route.

## What Is Implemented

| Stage | Implemented now | Evidence |
|---|---|---|
| Stage 1 | Claude/Codex session discovery keeps unhealthy sessions with heartbeat time and failure reason; WorkerPoolRouter routes only healthy sessions and returns HOLD when none are usable. | `packages/runner/src/worker-session-discovery.ts`, `packages/runner/src/worker-pool-router.ts`, `evidence/v23/stage1/acceptance.json` |
| Stage 2 | LeadAgent emits structured brainstorm summary, PRD, ADR draft, roadmap, checkpoints, and DAG; schema rejects coder tasks with no write files and tasks with no expected evidence. | `packages/daemon/src/lead-agent.ts`, `packages/core/src/mission-design.ts`, `evidence/v23/stage2/stage-specific/stage2-mission-design.json` |
| Stage 3 | Manual/roadmap/GitHub/TODO/failing-test candidates share classifier schema; autonomous intake records HOLD-FLOOD when cap overflows. | `packages/daemon/src/mission-intake-source.ts`, `packages/daemon/src/autonomous-intake.ts`, `evidence/v23/stage3/acceptance.json` |
| Stage 4 | MissionRunner reads mission design, writes DAG evidence, executes bounded move sequence, records move manifest, and HOLDs on move failure. | `packages/daemon/src/mission-runner.ts`, `evidence/v23/stage4/stage-specific/stage4-6-runtime.json` |
| Stage 5 | Validator prompt construction forcibly calls `redactForValidator()`; forbidden transcript/model/cost files are dropped before prompt construction. | `packages/validators/src/evidence-prompt.ts`, `evidence/v23/stage5/validator-leak-scan.json` |
| Stage 6 | v2.3 defaults to draft-only; AUTO_MERGE policy decisions are downgraded to WAITING and emit `mission.auto_merge_blocked`. | `packages/daemon/src/mission-runner.ts`, `evidence/v23/stage6/stage-specific/stage4-6-runtime.json` |
| Stage 7 | Status board JSON can expose Mission OS queue depth, worker health, provider distribution, checkpoint waits, draft PR waits, and last acceptance status. | `packages/daemon/src/dashboard/status-board.ts`, `evidence/v23/stage7/stage-specific/stage7-dashboard.json` |
| Stage 8 | Guarded soak command exists and writes machine-readable reports for mock, real, and draft-pr modes. | `scripts/mission-os-guarded-soak.ts`, `evidence/v23/stage8-*/guarded-soak-*/guarded-soak.json` |

## What Was Overclaimed

1. **The first acceptance harness was too generic.**
   It required dry-soak, route evidence, validator leak scan, idempotency, and
   real-soak policy, but Stage 2 and Stage 4 could pass without proving mission
   design or DAG runtime specifically. This is now patched by `stageChecks`.

2. **Real-soak proves session viability, not full MissionRunner production.**
   The real Claude/Codex soak edits a temporary README through each CLI. That is
   valuable because missing login/session health becomes HOLD/failed evidence,
   but it is not the same as running a real repo mission end to end.

3. **Stage 4 is bounded DAG execution, not parallel DAG execution.**
   The current MissionRunner executes DAG tasks in topological order through
   bounded moves. It detects write conflicts and serializes safely, but it does
   not yet execute independent DAG nodes concurrently inside one mission.

4. **Stage 7 exposes dashboard shape, not live dashboard aggregation.**
   The pure status board contract exists. The daemon still needs a production
   aggregator that fills `mission_os` from queue depth, worker probes, holds, and
   latest acceptance evidence in the live server path.

5. **Stage 8 one-iteration soak is an entrypoint proof, not a wall-clock soak.**
   The commands are wired and pass. A true 2h/12h/24h soak still needs to run on
   operator-approved wall-clock time and should not be claimed from a short run.

## Debug Fixes Made After Review

- Acceptance reports now support `stageChecks`; failed stage-specific checks
  make the whole report fail.
- `scripts/mission-os-acceptance.ts` now runs targeted checks for each stage:
  subscription routing, mission design schema, intake classifier, bounded DAG +
  draft gate, validator isolation, dashboard contract, and guarded-soak wiring.
- MissionRunner validator family enforcement no longer derives validator
  constraints from the coder route. Configured reviewer/validator families are
  preflighted and same-family conflicts HOLD before validation continues.

## Next Route

1. **Live scheduler integration:** fill `mission_os` status from real queue,
   worker probes, active moves, holds, draft PR waits, and latest acceptance
   reports in the daemon server path.
2. **Parallel DAG dispatch:** split the current serial bounded move sequence into
   ready-level batches with repo/file locks and explicit evidence for parallel vs
   serialized decisions.
3. **Real MissionRunner subscription soak:** run a real tiny mission through
   MissionRunner using Claude and Codex workers, not only direct CLI README edits.
4. **Recovery proof:** add an integration test that interrupts a running move,
   restarts from event/evidence state, and proves completed moves and draft PR
   side effects are not repeated.
5. **Wall-clock soak:** run 2h mock, 12h real local, then 24h guarded draft PR
   against a test repo before calling v2.3 production-hard.

