# Operator Cockpit UX v2 PRD / Claude Code Prompt

## Context

I tested the current Claude Code 24/7 Operator Cockpit at `http://127.0.0.1:7248`.
The core flow can start, brainstorm, generate PRD/ADR/Roadmap, approve, and start execution, but the operator experience is confusing and does not feel like an interactive coding coworker.

Please redesign the Operator Cockpit interaction model and Web UI so it behaves closer to Claude Code / Claude Desktop: a chat-first workspace with explicit clarification prompts, visible agent progress, clear token/provider transparency, and controllable side/bottom panels.

## Problems Observed

1. Brainstorm starts without a real conversational interaction.
   - After clicking `New Brainstorm`, the assistant outputs one large markdown block in the left conversation.
   - It is unclear whether brainstorm is one AI agent or multiple agents discussing.
   - It is unclear whether the brainstorm uses subscription/local CLI tokens or paid API tokens.
   - The brainstorm result is a one-shot dump, not a back-and-forth discussion.
   - The assistant includes questions and recommended choices inside markdown text, but the UI does not turn them into interactive choices.

2. Clarification UX is poor.
   - Clicking "ask me 3 questions" only appends another large assistant message near the bottom-left.
   - There is no modal, popover, structured prompt, or chat composer focused on answering the questions.
   - The user must go back to the original prompt box and click `Add Note`, which feels awkward and hidden.
   - Desired behavior: Claude Code-style automatic clarification cards/popups with selectable options plus a free-form reply box.

3. Stale HOLD warnings remain visible after recovery.
   - The UI continues showing `Planner HOLD: HOLD-ROADMAP-PLANNER: local planner CLI could not produce a valid PRD/ADR/Roadmap design. codex-cli timed out after 120000ms`
   - This warning remains even after the underlying issue is resolved and later actions succeed.
   - HOLD state must be scoped to the current action/session state and cleared when a successful retry supersedes it.

4. Start/execution progress is opaque.
   - After clicking `Start`, the operator cannot tell what is actually happening.
   - The UI shows sparse raw log lines such as timestamps, but not a human-readable status.
   - Ten minutes can pass with no meaningful progress update.
   - There is no clear next step, stop/end button, "send to validators" action, or explanation of whether execution is still running, waiting, failed, blocked, or complete.

5. Overall Web UI is cluttered and hard to use.
   - The current three-column UI feels noisy and visually disorganized.
   - Desired layout should be closer to Codex / Claude Code Desktop:
     - Left sidebar: mission/history list.
     - Main area: chat conversation with assistant/user turns.
     - Right side panel: mission details, artifacts, PRD/ADR/Roadmap, approvals, validators.
     - Bottom panel: logs, events, worker output, token/cost usage.
     - Controls for panel width, toggle bottom panel, toggle side panel.
   - Each assistant response should end with a clear status/update footer showing what changed and what the next possible actions are.

## Product Goals

1. Make Operator Cockpit feel like an interactive AI coworker, not a static dashboard.
2. Make every long-running action visibly alive, cancellable, and explainable.
3. Make clarification questions first-class structured UI, not buried markdown.
4. Make provider/token/cost mode transparent for brainstorm, planning, worker, and validators.
5. Replace stale error/HOLD behavior with current, actionable state.

## Required UX Changes

### A. Chat-First Layout

Implement a redesigned cockpit shell:

- Left sidebar: session/mission history, status badges, search/filter, "New Mission".
- Main chat: user and assistant messages in a familiar chat thread.
- Composer: persistent bottom chat input with `Send`, `Ask 3 questions`, `Generate PRD`, and context-aware quick actions.
- Right panel: collapsible mission panel with PRD/ADR/Roadmap/artifacts/approval state.
- Bottom panel: collapsible execution/log panel with worker logs, event stream, validators, and token/cost details.
- Panel controls: toggle side panel, toggle bottom panel, resize panel width if feasible.

### B. Structured Clarification Flow

When brainstorm or follow-up produces questions:

- Parse or return structured `OperatorQuestion[]` from the daemon instead of only markdown.
- Render a floating clarification card or inline modal.
- Each question supports:
  - question text,
  - recommended option,
  - 2-4 selectable options,
  - optional free-form answer,
  - "answer all and continue" CTA.
- User answers should be stored as explicit operator messages/events.
- The clarified answers must be included in PRD/ADR/Roadmap generation input.
- The UI should never require the user to hunt for the original prompt box to answer questions.

### C. Brainstorm Transparency

Show a compact "agent/provider" strip for each major action:

- Brainstorm provider: `claude-cli`, `codex-cli`, `mock`, or API provider.
- Auth/cost mode: subscription/local CLI vs paid API fallback vs validator-only API.
- Agent mode: single planner, multi-agent panel, or validator family.
- Token/cost summary when available.
- If only one planner is used, say that honestly. Do not imply multiple agents are debating.

### D. HOLD/Error Lifecycle

Fix HOLD display semantics:

- HOLD banner must show only active/current blockers.
- When a retry succeeds, clear stale HOLD banners for the superseded action.
- Keep historical HOLDs in the event/log panel, not as active top-level alarms.
- The top-level coach card should distinguish:
  - action running,
  - action succeeded,
  - action blocked/HOLD,
  - action timed out,
  - waiting for operator input.
- Timeout errors should include direct recovery actions: retry, switch provider if configured, use explicit template fallback for test mode, or inspect logs.

### E. Execution Progress After Start

After `Start`:

- Show a live run timeline with stages: queued, assigned, worker starting, coding, tests, evidence, validators, PR gate, done/blocked.
- Show active worker/provider, current task, elapsed time, last heartbeat, and last meaningful progress.
- Convert raw event/log lines into readable status updates.
- If no progress for a threshold, show "possibly stalled" with a retry/stop/diagnose action.
- Provide clear action buttons:
  - Stop / Pause execution,
  - Resume,
  - Run validators,
  - Create draft PR when eligible,
  - Diagnose stalled run.
- At completion, show a final summary: files changed, evidence, tests, validators, PR status, next action.

### F. Message Update Footers

Every assistant message should end with a small structured update footer:

- `Status`: thinking / waiting for you / running / blocked / complete.
- `Changed`: what was created or updated.
- `Next`: recommended next action.
- `Provider`: planner/worker/validator source and token mode.

## Backend/API Requirements

Add or adapt APIs as needed:

- Return structured brainstorm metadata:
  - provider,
  - auth/cost mode,
  - single-agent vs multi-agent,
  - token usage,
  - generated questions/options.
- Store clarification answers as events/messages.
- Expose current active HOLDs separately from historical HOLD events.
- Expose run heartbeat and progress summaries for the UI.
- Add readable status mapping for execution events.

## Acceptance Criteria

1. Starting a brainstorm immediately shows a visible "planner is thinking" chat turn and provider/token mode.
2. Brainstorm completion renders concise assistant output plus interactive question cards when questions exist.
3. Selecting/replying to clarification questions updates the conversation and feeds into PRD generation.
4. `Generate PRD` success clears stale planner HOLD banners and shows PRD/ADR/Roadmap in the side panel.
5. Active HOLDs are prominent; historical/superseded HOLDs are only in logs/events.
6. Clicking `Start` shows a live, human-readable execution timeline within 2 seconds.
7. If no worker progress occurs for a configured threshold, the UI shows a stalled/diagnostic state.
8. The operator can always see what is running, what token/provider mode is being used, what changed, and what action is recommended next.
9. The layout is responsive and usable on desktop and mobile.
10. Existing safety rules remain intact: no hidden API fallback, no remote writes unless explicitly allowed, no fake success.

## Suggested Implementation Plan

1. Add structured types for operator questions, action metadata, active holds, and run status summaries.
2. Update daemon routes to return and persist these structures.
3. Replace the cockpit page with a chat-first shell and collapsible panels.
4. Implement clarification cards and answer submission.
5. Implement active HOLD lifecycle and stale HOLD clearing.
6. Implement execution timeline and stalled-run detection.
7. Add tests for brainstorm questions, HOLD clearing, PRD generation, start progress, and panel state.
8. Run `pnpm typecheck`, `pnpm lint`, targeted cockpit tests, and the cockpit e2e flow.

## Prompt To Use With Claude Code

Please implement Operator Cockpit UX v2 using the PRD above. Focus on making the app feel like Claude Code Desktop: chat-first, interactive clarification cards, transparent provider/token mode, current-only HOLD warnings, and a live execution timeline after Start. Preserve all safety gates and repository policies. Do not fake AI results or silently fall back to paid APIs. Add or update tests that prove the new interaction model works end-to-end.
