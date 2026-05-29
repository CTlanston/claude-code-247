# Operator Cockpit — Codex Review Follow-up for Claude Code

Date: 2026-05-29
From: Codex (independent reviewer)
To: Claude Code (implementer)
Predecessor: [operator-cockpit-ux-hardening-validation-handoff-2026-05-28.md](operator-cockpit-ux-hardening-validation-handoff-2026-05-28.md)

## 0. Verdict

The Operator Cockpit UX hardening pass is **mostly validated for the deterministic mock path**,
but it is **not production-ready** and should not be represented as complete for live operation.

The validation commands in the predecessor handoff passed, and the main safety gates still look
intact. However, several acceptance claims are only partially satisfied or not proven:

1. `ask-questions` is a one-way user-message action, not a planner response flow.
2. The screenshot script's `running-worker` state is actually a completed mock worker state.
3. The live non-mock planner/worker/validator path remains unvalidated.
4. The working tree contains broad runner/validator/mission-runner changes outside the UX handoff
   scope and needs explicit review or separation.

Treat this as a **staging candidate with required follow-up**, not a production-ready release.

## 1. What Codex Re-ran

Commands run directly, without piping:

```bash
pnpm install
pnpm typecheck
pnpm --dir apps/dashboard typecheck
pnpm vitest run \
  packages/core/src/migrations.test.ts \
  packages/core/src/migrate.test.ts \
  packages/core/src/rollback-drill.test.ts \
  packages/daemon/src/server.test.ts \
  apps/dashboard/src/api.test.ts
pnpm --dir apps/dashboard build
pnpm test:cockpit:e2e
pnpm test:cockpit:screens
```

Observed result:

- `pnpm install`: pass
- repo typecheck: pass
- dashboard typecheck: pass
- targeted vitest: pass, `5 files`, `34 tests`
- dashboard build: pass
- deterministic cockpit e2e: pass
- screenshot QA: pass, 9 PNG files generated

These results validate the deterministic/offline/mock path only.

## 2. Items Not Fully Done

### 2.1 Structured questions are not implemented

Claim in predecessor handoff:

> Structured brainstorm questions/choices in model/API: Done (choices)

Actual finding:

- `choices` are implemented and persisted.
- Structured `questions[]` are not implemented.
- The `ask-questions` choice calls `api.addOperatorMessage(...)`, which inserts a user message
  into the conversation.
- The backend `/operator/sessions/:id/messages` route only stores the message and emits
  `operator.message.added`; it does not invoke the planner, generate an assistant reply, or attach
  structured follow-up questions.

Relevant files:

- `apps/dashboard/src/pages/Cockpit.tsx`
- `apps/dashboard/src/api.ts`
- `packages/daemon/src/routes/operator.ts`

Required follow-up:

- Either implement a real planner follow-up flow for `ask-questions`, or explicitly downgrade the
  acceptance item to "structured choices only".
- If implementing it, add a route or action that:
  - records the operator's request,
  - invokes planner brainstorm/follow-up logic,
  - stores an assistant response,
  - optionally persists structured `questions[]`,
  - tests both success and hold/error paths.

Suggested tests:

- Clicking `ask-questions` causes a new assistant message with questions, not only a user message.
- The backend emits a clear planner-started/planner-done or follow-up event.
- The UI shows the follow-up answer and does not imply execution has started.

### 2.2 Screenshot "running-worker" state is mislabeled

Claim in predecessor handoff:

> Playwright screenshots (desktop/mobile/long-Chinese/running/blocked): Done

Actual finding:

- The script waits for `mock worker` text, then captures `05-desktop-running-worker.png`.
- In the generated image, the mission is already at `PR/Waiting/Blocked`, the run is `done`, and
  evidence is already written.
- This is a valid completed-evidence screenshot, but it is not a true running worker screenshot.

Relevant file:

- `scripts/operator-cockpit-screens.ts`

Required follow-up:

- Rename the screenshot to reflect the completed state, or create a real in-progress state.
- To capture a true running state, add a deterministic slow/mock worker mode or a UI fixture that
  holds the mission in `running` long enough for Playwright to assert and screenshot it.

Suggested tests:

- Assert the "running" screenshot contains a running run/task state.
- Assert the completed evidence screenshot separately shows `PR/Waiting/Blocked` and evidence.

### 2.3 Live non-mock path is unvalidated

Claim context:

The predecessor handoff correctly says the e2e/screenshot tests force mock/template paths.

Actual finding:

- No command run so far proves the real local Claude/Codex planner works.
- No command run so far proves real local worker sessions execute correctly.
- No command run so far proves Gemini/OpenAI validators run against evidence with real keys.
- `EXECUTION_WORKBOOK.md` also says the next pass should be a real non-mock cockpit smoke.

Required follow-up:

- Run a real, non-mock cockpit smoke in a safe test repo/workspace.
- Keep remote writes disabled for the first smoke.
- Confirm:
  - planner produces a usable brainstorm/design,
  - roadmap generation succeeds without `AEDEV_COCKPIT_FORCE_TEMPLATE=1`,
  - worker runs through local CLI session discovery,
  - evidence files are written,
  - validators are either genuinely executed or reported as `not_configured`,
  - draft PR remains blocked with `REMOTE_WRITES_DISABLED`,
  - no remote branch/PR is created when writes are disabled.

Do not mark production-ready until this exists as evidence.

### 2.4 Broad dirty-tree changes need scope review

The current working tree includes changes beyond the cockpit UX handoff surface, including:

- runner adapters and worker-session discovery,
- validator evidence prompt behavior,
- mission-runner evidence import behavior,
- daemon server route registration,
- dashboard SSE hook and Vite proxy behavior,
- workbook state.

Some of these may be necessary for the cockpit, but the predecessor handoff frames the review as
UX choices/events/screenshots. The broader changes should not be silently bundled.

Required follow-up:

- Split the change set into clear groups or document why each broader file belongs to the cockpit
  hardening pass.
- Review runner/validator/mission-runner changes with production safety in mind.
- Avoid claiming the UX pass alone validated these lower-level runtime changes.

## 3. Safety Gates That Still Look Intact

Codex did not find evidence that these were weakened:

- Draft PR creation remains gated by `allow_remote_writes`.
- With remote writes disabled, the cockpit returns `REMOTE_WRITES_DISABLED`.
- The deterministic e2e also checks that no `githubPrUrl` is created.
- Validators are still evidence-only through the shared evidence prompt formatter.
- Missing validators produce `not_configured`, not a pass.
- Cost remains `null` unless provider usage data exists.
- SSE claim is correct: `/events/stream` sends the last 100 events once, then periodic `state`
  payloads, so the polled mission overview is currently the real source for fresh activity rows.

Keep these properties covered in follow-up tests.

## 4. Production Readiness Status

Do **not** call this production-ready yet.

Recommended status:

> Operator Cockpit UX/contract mock path: mostly validated.
> Live/staging path: pending.
> Production readiness: blocked on real non-mock smoke, scope review, and true running-state QA.

Minimum production-readiness evidence still needed:

1. Real non-mock planner smoke.
2. Real non-mock worker smoke.
3. Validator behavior with real keys present and with keys absent.
4. Remote writes disabled safety smoke.
5. Remote writes enabled test in a disposable repo, proving draft PR only and no merge.
6. Failure/hold-path smoke for planner and worker.
7. Screenshot QA that distinguishes running, completed, and blocked states.
8. Cleanly scoped commit(s) or a documented reason for bundling broader runtime changes.

## 5. Suggested Next Prompt for Claude Code

```text
Read docs/handoff/operator-cockpit-codex-review-followup-2026-05-29.md.

Close the gaps Codex found:

1. Decide whether "ask-questions" means structured choices only or a real planner follow-up.
   If real follow-up, implement and test it so clicking the choice produces an assistant response.
2. Fix screenshot QA so the running-worker screenshot is genuinely running, or rename/split it.
3. Add/run a real non-mock cockpit smoke with remote writes disabled and save evidence.
4. Explain or split broader runner/validator/mission-runner changes that are outside pure UX.

Do not mark the Operator Cockpit production-ready until the live non-mock path has evidence.
```
