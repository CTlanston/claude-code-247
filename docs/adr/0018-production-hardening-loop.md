# ADR-0018: Production Hardening Loop and Automation Consolidation

**Status:** Accepted
**Date:** 2026-05-29
**Builds on:** [ADR-0010](0010-three-plane-event-sourced.md), [ADR-0017](0017-v2.4-vertical-slice-dual-validation.md)

## Context

The project had multiple active continuation surfaces: a v2.3 cron, a second
v2.3 cron, a current-thread heartbeat, and unrelated project automations. That
made it too easy for agents to continue stale worktrees, duplicate handoffs, or
optimize the wrong proof.

The operator selected the current v24 repository as the only canonical target
for Claude Code 247 production hardening. The target is not another synthetic
stage claim; it is a production-usable local-first 24/7 coding coworker with a
daemon policy plane, worker side-effect plane, evidence-only validators, a
draft-PR gate, secret grants, and real launchd soak evidence.

## Decision

1. `PRODUCTION_WORKBOOK.md` is the production-hardening control surface. It
   owns the P0-P6 queue, acceptance gates, HOLD rules, and next action.
2. `EXECUTION_WORKBOOK.md` remains the repository ledger and must point to the
   production workbook from section 0. It is no longer the place to invent a
   second production-hardening plan.
3. The stable handoff entry is `docs/handoff/production-handoff-latest.md`.
   Agents may add dated evidence, but the latest handoff is the first file a
   continuation run should read after the two workbooks.
4. Only one Claude Code 247 automation remains active: the cron named
   `Claude Code 247 production hardening loop`, fixed to
   `/Users/lanston/projects/claude-code-247`. The old v2.3 cron, duplicate
   v2.3 cron, and current-thread heartbeat are paused.
5. The CommentPilot guard remains active as a separate auxiliary automation,
   fixed to `/Users/lanston/projects/commentpilot-247`. It must not touch this
   repository.
6. Runtime churn is not source truth. High-frequency launch ticks are summarized
   in rollup evidence, and raw future tick payloads are ignored unless a
   workbook stage explicitly promotes one.
7. Daemon code owns policy and durable state, not subprocess side effects.
   `git`, `gh`, Claude, and Codex subprocess execution belongs in worker or
   side-effect packages. The daemon may depend on injected interfaces and gates.

## Consequences

- Future autonomous runs have one source of truth for the next stage and one
  stable handoff file.
- Production readiness is measured by stage evidence, not by automation
  activity volume.
- Remote writes stay disabled unless the workbook stage, config safety gate,
  and repo registry all authorize them.
- Historical v2.3 worktrees remain useful context, but they cannot be active
  implementation targets without a new operator decision.

## Validation

- Automation inventory shows only the Claude Code 247 production loop and
  CommentPilot guard as active.
- `git status --short` excludes raw roadmap tick churn and local self-dev
  launchd prototypes.
- `pnpm lint` must not scan runtime worktrees under `evidence/**/state/**`.
- Daemon source must not import `child_process`.
- Each production-hardening slice ends by updating `PRODUCTION_WORKBOOK.md` and
  `docs/handoff/production-handoff-latest.md`.
