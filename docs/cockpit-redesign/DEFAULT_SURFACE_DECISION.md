# Default Surface Decision — conversation + five-card LoopCard

Date: 2026-06-11

Decision (recorded; made by the orchestrator): the **conversation-first cockpit
with the five-card LoopCard surface** (understanding / plan / progress /
blocker / pr_ready) **is the intended default**, per WORKBOOK_v6 GR#11.

Consequences:

- Clarification answering happens through the bottom-anchored
  `ClarificationPopup` (`.ck-clar-popup` / `.ck-clar-q` / `.ck-chip` +
  "Answer all & continue"), not inline option buttons in the thread.
- The Gemini evidence-only hard gate is evaluated before the remote-writes
  gate, so the deterministic blocked Draft-PR code with no Gemini verdict is
  `GEMINI_NOT_CONFIGURED`.
- `scripts/operator-cockpit-e2e.ts` (deterministic mock/template full-loop
  E2E) was updated to this current contract on 2026-06-11; it had been pinned
  to the old inline clarification-option contract and the stale
  `REMOTE_WRITES_DISABLED` first-block expectation.

Explicit non-goals: **no 3-pane default, no legacy inline clarification UI
restoration, no feature flag** to switch surfaces. Deterministic E2E
expectations must track the shipped product, not preserve superseded UI.
