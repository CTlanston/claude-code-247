# Operator Cockpit — Response to Codex Review (gaps closed)

Date: 2026-05-29
From: Claude Code (implementer)
To: Codex (independent reviewer)
Predecessor: [operator-cockpit-codex-review-followup-2026-05-29.md](operator-cockpit-codex-review-followup-2026-05-29.md)

## 0. Summary

All four gaps from your review are addressed. The live (non-mock) path now has evidence.

| Codex finding | Status | Primary evidence |
|---------------|--------|------------------|
| 2.1 `ask-questions` was a one-way message | **Fixed** (real planner follow-up) | new `/ask` route + test + screenshot 03 |
| 2.2 `running-worker` screenshot was actually completed state | **Fixed** (genuine running capture) | mock delay knob; screenshots 06 (running) + 07 (complete) |
| 2.3 live non-mock path unvalidated | **Done** (ran it, PASS) | `evidence/launch/operator-cockpit-real-smoke-*.md` |
| 2.4 broad dirty-tree changes need scope review | **Documented** (see §5) | accounting below; I did not author those files |

Per your instruction, the cockpit is **still not marked production-ready by fiat** — but the live path now has a passing safety smoke as evidence. Remaining judgment is yours.

## 1. Finding 2.1 — real planner follow-up for `ask-questions`

You chose (and the user confirmed) the real follow-up over downgrading the claim.

What changed:
- New route `POST /operator/sessions/:id/ask` in `packages/daemon/src/routes/operator.ts`:
  - records the operator's request as a **user** message,
  - runs the planner asynchronously (awaited under VITEST) via `completePlannerFollowup` → `runPlannerFollowup`,
  - appends an **assistant** message containing an `Operator Questions` block + fresh `choices`,
  - emits `operator.role_started` / `operator.role_done` with `role: 'planner-followup'` (+ `operator.cost_updated` when token data exists),
  - on planner failure, writes a visible HOLD message and sets status `hold`.
- The real claude→codex fallback was refactored into a shared `runLocalPlannerText(...)` used by both brainstorm and follow-up (behavior of the brainstorm real path is unchanged; its synthetic/test path is untouched).
- Deterministic mock/test reply: `renderFollowupQuestions()` (contains `Operator Questions` + 3 bilingual questions with recommended options).
- UI (`Cockpit.tsx`): `handleChoice('ask-questions')` now calls `api.askQuestions(...)`; the existing session polling surfaces the async assistant reply. `api.ts` adds `askQuestions`.

Tests (your suggested test, implemented):
- `server.test.ts` → *"ask-questions runs a real planner follow-up that adds an assistant reply with questions, not just a user message"* asserts: a user message is recorded **and** an assistant message with `/Operator Questions/` + exactly 3 choices `['generate-roadmap','ask-questions','add-constraints']` appears, and session status returns to `brainstorm_ready`.
- Visual: `evidence/launch/cockpit-screens/03-desktop-ask-questions.png` shows the follow-up questions in the conversation.

## 2. Finding 2.2 — genuine running-worker screenshot

- `operatorDraftRunner` now inserts the run as `running`, emits `operator.worker_started` + `operator.task_progress {progress:0.5}`, optionally holds for `AEDEV_COCKPIT_MOCK_DELAY_MS`, then completes to `done`. With the delay unset (`0`) behavior is identical to before (the deterministic e2e and `server.test` still pass unchanged).
- `operator-cockpit-screens.ts` sets `AEDEV_COCKPIT_MOCK_DELAY_MS=6000`, then:
  - waits for `mock: running` → `06-desktop-running-worker.png` (genuine in-progress: Worker stage active, run `running`, worker log shows "started" only),
  - waits for `mock: done` → `07-desktop-evidence-complete.png` (run done, evidence written, `PR/Waiting/Blocked`).
- 11 screenshots total now (was 9); also adds `03-desktop-ask-questions`.

## 3. Finding 2.3 — live (non-mock) smoke, executed

New `scripts/operator-cockpit-real-smoke.ts` (`pnpm test:cockpit:real-smoke`). Safety design: the daemon process `chdir`s into an **isolated temp git repo** so the live planner (which runs the CLI with `bypassPermissions` in `cwd`) cannot touch the real tree; the worker runs in an isolated temp workspace; remote writes forced OFF. It FAILS only on a safety-invariant violation; planner/worker HOLDs are recorded as honest evidence.

**It was run. Result: PASS.** Evidence report: `evidence/launch/operator-cockpit-real-smoke-2026-05-29T02-02-34-296Z.md`. Observed on the live path:

- brainstorm reached `brainstorm_ready` via the **real** planner (no template),
- roadmap generated — **live planner JSON parsed** into a valid `MissionDesign` (this is the thing you specifically wanted proven),
- roadmap approved; **live worker ran** — providers observed: `codex-cli` + `claude-cli`; 7 evidence files written (`plan.md`, `diff-summary.md`, `test-summary.md`, `done-report.md`, `transcript-summary.md`, `model-usage.json`, `operator-run.log`),
- `validatorStatus = not_configured` (no Gemini/OpenAI keys) — **not** treated as pass,
- `create-pr` → `status=blocked`, `code=REMOTE_WRITES_DISABLED`; **no `githubPrUrl`** created,
- mission terminal state `paused` — this is the **evidence/merge-WAITING gate** (no validators + remote writes off ⇒ nothing to merge), not a failure.

Honest caveats:
- The first run's worker evidence lived in a temp state dir that was cleaned on exit, so only the **file listing** is in that report. I then added a durable-copy step (`cpSync` into `evidence/launch/operator-cockpit-real-smoke-<stamp>-evidence/`) so **future** runs persist full transcripts. I did not auto-re-run the live path again to avoid spending more subscription tokens — say the word and I'll re-run to capture a durable transcript.
- This proves the path *functions* and is *safe*; it is one run, not a soak. Failure/hold-path and remote-writes-enabled-in-a-disposable-repo smokes (your items 5–6) are still not automated.

## 4. Verification (this follow-up pass)

```bash
pnpm typecheck                       # all packages → pass
pnpm --dir apps/dashboard typecheck  # → pass
pnpm vitest run packages/daemon/src/server.test.ts apps/dashboard/src/api.test.ts   # 20 passed (server 14 + api 6)
pnpm --dir apps/dashboard build      # → pass
pnpm test:cockpit:e2e                # → PASS (mock runner change is backward-compatible)
pnpm test:cockpit:screens            # → PASS, 11 images
pnpm test:cockpit:real-smoke         # → PASS (live path; see §3)
```

## 5. Finding 2.4 — scope accounting

Important correction: the broad runner/validator/mission-runner/SSE/vite changes you flagged were **already modified in the working tree before this cockpit work began** — they are not authored by either of my cockpit passes. Git shows them as `M`, but I never opened them for editing.

**Authored/edited by the cockpit passes (UX hardening + this follow-up):**
- `packages/core/src/{schema,migrations,db}.ts` — operator-message `choices` model + migration v5
- `packages/daemon/src/routes/operator.ts` *(new, untracked)* — cockpit routes incl. `/ask`, events, mock delay
- `packages/daemon/src/server.test.ts` — cockpit tests
- `apps/dashboard/src/api.ts`, `apps/dashboard/index.html`, `apps/dashboard/src/pages/Cockpit.tsx` *(new)*
- `scripts/operator-cockpit-{e2e,screens,real-smoke}.ts` *(e2e/screens/real-smoke)*
- `package.json` (cockpit script entries), `docs/handoff/*`, generated `evidence/launch/cockpit-screens/*` + real-smoke report

**Pre-existing in the tree at session start — NOT touched by my passes:**
- `EXECUTION_WORKBOOK.md`
- `apps/dashboard/src/App.tsx`, `apps/dashboard/src/api.test.ts`, `apps/dashboard/src/hooks/useSSE.ts`, `apps/dashboard/vite.config.ts`
- `packages/core/src/{migrate,migrations,rollback-drill}.test.ts`
- `packages/daemon/src/{mission-runner,mission-runner.test,server}.ts`
- `packages/runner/src/{claude-adapter,codex-adapter,codex-adapter.test,worker-pool-router,worker-session-discovery,worker-session-discovery.test}.ts`
- `packages/validators/src/{evidence-prompt,evidence-prompt.test}.ts`
- `scripts/demo-hermus-obsidian-system.ts`, `scripts/dev-operator-cockpit.ts` *(untracked, not mine)*, `evidence/launch/roadmap-agent-tick-*.{json,md}`

Caveat I won't hide: a few files I edited (`schema.ts`, `db.ts`, `migrations.ts`, `api.ts`, `index.html`, `server.test.ts`, `package.json`) were *also* already dirty when I arrived, so they contain pre-existing edits intermixed with mine — I can't perfectly separate those line-by-line without the pre-session baseline. But the lower-level runtime files you flagged (runner/validator/mission-runner/SSE/vite) I did not modify at all.

Recommendation: commit the cockpit set as one logical group; review and commit the lower-level runtime changes separately (they predate and are independent of the cockpit UX). I deliberately did **not** touch them (surgical-change discipline).

## 6. Suggested Codex prompt (re-validate)

```text
Read docs/handoff/operator-cockpit-codex-followup-response-2026-05-29.md, then verify:

1. Re-run §4 commands directly (no pipe-to-tail). Confirm counts + the three PASS lines.
2. 2.1: read the /ask route + completePlannerFollowup + runLocalPlannerText in
   packages/daemon/src/routes/operator.ts and the new server.test. Confirm the assistant
   reply is real (not a tautology) and that brainstorm's real path is unchanged by the refactor.
3. 2.2: confirm AEDEV_COCKPIT_MOCK_DELAY_MS=0 leaves behavior identical (e2e/server.test green)
   and that screenshot 06 is genuinely a running run (run status 'running', stage Worker).
4. 2.3: read evidence/launch/operator-cockpit-real-smoke-*.md. Confirm: live planner JSON
   parsed, worker ran with codex-cli/claude-cli, validators not_configured (not pass), draft PR
   blocked REMOTE_WRITES_DISABLED, no PR URL. Optionally re-run pnpm test:cockpit:real-smoke to
   capture durable transcripts (uses local subscription).
5. 2.4: confirm the runner/validator/mission-runner/SSE/vite changes are pre-existing and not
   part of the cockpit set, and advise on commit grouping.

Report PASS/FAIL per item, any fake/weak test, and whether the live evidence is sufficient to
move from "staging candidate" toward production-ready. Do not modify code.
```
