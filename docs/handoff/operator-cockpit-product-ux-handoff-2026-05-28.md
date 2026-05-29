# Operator Cockpit Product UX Handoff

Date: 2026-05-28

## User Feedback Summary

The current Operator Cockpit is technically runnable, but the user experience still feels like an engineering console rather than an AI coworker product.

The key user complaint:

- After clicking **Approve Roadmap**, the page appears to stop moving.
- The user cannot clearly tell what happened, what the system is doing, or what the next step is.
- The UI does not yet feel like Claude Code / Codex / Claude coworker style interaction.
- Brainstorm should not be a one-way generated block. It should ask the user questions, present choices, and guide confirmation before roadmap generation.
- During execution, every action should be visible:
  - What is currently running?
  - Which agent was assigned?
  - Which CLI/provider is being used?
  - What stage is active?
  - What is blocked?
  - Where are PRD/ADR/roadmap/evidence?
  - What validator ran and what was the result?
- The interface should support Chinese and English.
- The visual design should feel Apple-like: simple, calm, clear, premium, low-friction, and easy for a non-technical user to follow.

## Product Direction

The Cockpit should become a guided AI coworker interface, not a raw daemon dashboard.

Target mental model:

```text
Idea → AI asks questions → user chooses direction → PRD/ADR/Roadmap → approval → agents execute → evidence gate → draft PR blocked/created by policy
```

The user should always know:

1. What just happened.
2. What is happening now.
3. What the system recommends doing next.
4. Whether the system is waiting for the user, an AI agent, a validator, or a safety gate.

## Required UX Behavior

### Brainstorm

When the user clicks **New Brainstorm**, the UI must immediately respond.

Expected behavior:

- A user message appears immediately.
- An assistant placeholder appears immediately:
  - English: `Brainstorm is running on the local planner CLI.`
  - Chinese: `AI 正在分析你的目标，会自动更新结果。`
- The system must not freeze while waiting for the planner CLI.
- When planner output arrives, it should include:
  - Brainstorm options
  - Recommended direction
  - Risks / unknowns
  - **Operator Questions**
  - 2-3 selectable next-step choices

The brainstorm should ask the user to confirm direction before generating the roadmap.

Example operator choices:

- `方向 OK，生成 PRD`
- `先问我 3 个问题`
- `补充约束`

### Roadmap Approval

When the user clicks **Approve Roadmap**, it must not look like nothing happened.

Expected behavior:

- The approval button should immediately show a working state.
- The top coach card should change to:
  - `路线图已批准`
  - `下一步可以启动执行`
- The stage timeline should move to `Approved`.
- The `Start Execution` button should become visually primary.
- The UI should make clear:
  - Approval does not start execution.
  - Approval only unlocks execution.

### Execution

When the user clicks **Start Execution**, the UI should show visible agent assignment and live progress.

Expected panels:

- Agent Activity:
  - Planner
  - Architect
  - Coder
  - Validator
- Current action:
  - `Assigning coder worker`
  - `Running Codex CLI`
  - `Writing evidence`
  - `Waiting for validators`
  - `Stopped at evidence gate`
- Live worker log:
  - show `operator-run.log`
  - append live `operator.worker_log` events
- Evidence links:
  - PRD
  - ADR
  - Roadmap
  - task DAG
  - transcript
  - test summary
  - risk report

### Validators

Validators must be explicit.

Expected behavior:

- If Gemini/OpenAI keys are missing:
  - show `not_configured`
  - explain that missing validators are not treated as pass
- If validators run:
  - show provider
  - verdict
  - summary
  - timestamp
- Validators must only read evidence, not chat/conversation context.

### Draft PR Gate

The UI should make policy blocks understandable.

Expected behavior:

- `Create Draft PR` should explain:
  - Remote writes are disabled by default.
  - This is a safety gate, not an error.
- If blocked:
  - show `REMOTE_WRITES_DISABLED`
  - show how to enable only after explicit configuration.
- Never auto-merge.

## Visual Design Requirements

The UI should move away from a dark engineering-console feel and toward a calm Apple-like product surface.

Design principles:

- Light, clean, spacious interface.
- Bilingual labels: Chinese first where useful, English alongside.
- Clear hierarchy:
  - top coach card for current state
  - left conversation
  - center plan and next action
  - right execution and observability
- Rounded but restrained controls.
- Primary action should be obvious.
- Do not require the user to understand internal daemon states.
- Avoid clutter and raw JSON in primary views.
- Raw event stream can remain secondary.

## Current Implementation State

Already implemented in the latest local changes:

- `New Brainstorm` no longer blocks on a synchronous planner call.
- Brainstorm now returns immediately with a placeholder message.
- Planner completes in the background and appends the real AI output.
- Planner prompt asks for `Operator Questions`.
- UI has a top coach card with bilingual guidance.
- UI has action notices for long-running actions.
- UI has a `ChoiceBar` after brainstorm.
- UI has `Agent Activity` visualization.
- Buttons now include bilingual labels.
- UI was restyled toward a light Apple-like surface.
- Local daemon/dashboard were restarted on:
  - daemon: `http://localhost:7247`
  - dashboard: `http://localhost:7248`

Validation run after UX changes:

```bash
pnpm typecheck
pnpm vitest run packages/daemon/src/server.test.ts apps/dashboard/src/api.test.ts
pnpm --dir apps/dashboard build
pnpm test:cockpit:e2e
```

All passed.

## Remaining UX Work

These items should be handled next:

1. Make the brainstorm questions truly structured, not just markdown text.
   - Backend should return `questions[]` or `choices[]`.
   - UI should render actual selectable options.

2. Add action-level progress events.
   - `roadmap_generation_started`
   - `roadmap_generation_done`
   - `approval_recorded`
   - `worker_assigned`
   - `worker_log_chunk`
   - `evidence_written`
   - `validator_started`
   - `validator_done`

3. Replace raw event stream as primary feedback.
   - Keep raw events collapsed or secondary.
   - Use friendly activity rows for normal users.

4. Improve `Approve Roadmap` transition.
   - Add success animation or status pulse.
   - Make `Start Execution` become the obvious next button.

5. Improve session recovery.
   - If localStorage points to a stale session, show a friendly reset option.
   - Add `New Mission` reset button.

6. Add a bilingual copy pass.
   - Make Chinese labels natural, not literal translations.
   - Keep English smaller or secondary.

7. Add visual QA with Playwright screenshots.
   - Desktop viewport.
   - Mobile/small viewport.
   - Long Chinese prompt.
   - Running worker state.
   - Blocked draft PR state.

## Acceptance Criteria

The feature should be considered product-ready only when:

- A non-technical user can start from one text box and understand every next step.
- Brainstorm returns questions/choices before execution planning.
- Approving the roadmap clearly changes state and guides the user to start execution.
- Starting execution visibly assigns agents and shows what each one is doing.
- The UI clearly distinguishes:
  - user waiting
  - AI thinking
  - worker running
  - validator waiting
  - policy blocked
  - evidence gate reached
- The UI is bilingual and comfortable for Chinese-first usage.
- No exact token/cost is faked.
- No PR/merge happens unless policy gates are explicitly enabled.

## Suggested Next Prompt

```text
Continue from docs/handoff/operator-cockpit-product-ux-handoff-2026-05-28.md.

Implement the next UX hardening pass:
1. Add structured brainstorm questions/choices to the operator session model/API.
2. Render selectable choices in the Cockpit conversation.
3. Convert raw execution events into friendly bilingual activity rows.
4. Make Approve Roadmap produce an obvious approved state and primary Start Execution CTA.
5. Add Playwright screenshot verification for desktop/mobile and long Chinese prompts.

Keep safety gates unchanged: no automatic merge, draft PR remains blocked unless allow_remote_writes=true, validators only read evidence.
Run pnpm typecheck, targeted tests, dashboard build, and cockpit e2e.
```
