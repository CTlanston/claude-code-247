# SESSION LOG v3

## s_v6_0007 · 2026-06-11 · CloudHull alpha hardening c0–c7 complete

- c0 truth check 3 suites PASS; c1–c4 real-smoke strict/DEGRADED semantics + GEMINI_TIMEOUT + regression-evidence gate + registered-repo path (38 tests); c5 multi-user local alpha (submittedBy, owner-gate, grouped missions, audit; +34); c6 /ops/overview + Ops page (+14); c7 alpha report with six-dimension scores. Suite 1036 passed / 0 failed. Live strict real-smoke + real Gemini verdict remain operator-gated (claude login on Mac).

## s_v6_0006 · 2026-06-11 · [reconcile-e2e] deterministic cockpit E2E reconciled to the current conversation+five-card contract

- Root cause: `scripts/operator-cockpit-e2e.ts` was pinned to the superseded inline clarification-option contract (`getByRole('button', { name: 'A specific test/command must pass ★' })`) and timed out — clarification answering moved into `ClarificationPopup` and the primary surface is conversation + LoopCard (WORKBOOK_v6 GR#11). Second stale expectation found and fixed: the Draft-PR gate now evaluates the Gemini evidence gate before remote-writes, so the deterministic blocked code is `GEMINI_NOT_CONFIGURED` (as quality-smoke already asserts), not `REMOTE_WRITES_DISABLED`.
- Fix (no product change, no flags, no old-UI restoration): the e2e now drives the popup with the exact selector contract of `operator-cockpit-user-e2e.ts` (`.ck-clar-popup` / `.ck-clar-q` / recommended `.ck-chip` / "Answer all" submit), uses the same deterministic fenced-JSON planner fixtures (brainstorm confidence 62 → answers → Ask Until Clear follow-up confidence 96 unlocks the plan), then keeps ALL its full-loop assertions: roadmap → approve → execute → root stage → PR gate card blocked + `pr_blocked` operatorView stage + exactly 1 mock run + artifacts + no PR URL.
- Decision recorded in `docs/cockpit-redesign/DEFAULT_SURFACE_DECISION.md`: conversation+five-card is the default; deterministic E2E must track the shipped product.
- Suites: `test:cockpit:e2e` PASS (was timing out), `test:cockpit:quality-smoke` PASS (evidence `evidence/browser-cockpit-quality/2026-06-11T14-18-20-197Z/`), `test:cockpit:user-e2e` PASS 7/7 (evidence `evidence/browser-cockpit-user-e2e/2026-06-11T14-18-36-321Z/`). Gates: typecheck/lint/test — 950 baseline, zero regressions.

## s_v6_0005 · 2026-06-11 · Overnight harness loop — P1/P3/P4/P5/P6 done · P2 honest HOLD

- P1: HOLD-PLANNER-AUTH detection + opt-in AEDEV_PLANNER_FALLBACK=codex (events record codex-cli (fallback), never impersonation) (+18). P3: operator-vocabulary cards + agent strip + on-card actions + PR-gate transparency, user-E2E 7/7 (+17). P4: merge-policy pure function, 864-combination sweep proves GR#10 (auto-merge off) (+14). P5: run-summary.md audit artifact on all four mission exits, absent-means-absent (+12). P6: full uninterrupted 30-min soak 5/5 PASS.
- P2 honest conclusion: REAL Draft PR exists (hermus-agent#4, operator-produced — remote-write gate truly proven); full cockpit chain + real Gemini verdict still HOLD-PLANNER-AUTH (operator claude login 401); recovery incl. the new fallback documented in evidence/v6/real-proof/.
- Suite: 950 passed / 0 failed.

## s_v6_0004 · 2026-06-11 · V6-P3 cycle-4 attempt → honest HOLD-REAL-PROOF-CREDENTIALS

- Planner chain (real, committed): env false-red REFUSE (cycle-2) → dirty-tree honest REFUSE (cycle-3) → clean PROPOSE cycle-4 = v6-p3-real-proof-closeout.
- Container lacks codex/gh/gemini CLIs, AEDEV_GEMINI_API_KEY, and a registered safe repo → real Draft PR + real Gemini verdict CANNOT be produced here; HOLD with exact 5-step operator recovery in evidence/v6/real-proof/ (GR#6/#7, no fabrication).
- Regression proofs re-run and captured (41 passed): whitelist-off/off-list blocks, Gemini non-PASS blocks create-pr, missing Gemini key fails closed.
- §0: blocked_on=operator_real_proof. Machine exit unchanged: Draft PR only, never merge (GR#10).

## s_v6_0003 · 2026-06-11 · V6-P4 + V6-P5 code complete · recursive planner + soak operationalization

- **V6-P4 recursive planner** (TDD, 20 tests first): `packages/daemon/src/recursive-planner.ts` — pure `planNextCycle` refuses on dirty tree / red tests / blocked budget (carries the budget reason) / ambiguous SoT (≠1 live root-workbook claim, `detectSotAmbiguity`) / open holds / unmerged previous-cycle PR / unparseable §0 / empty gap registry, each with a human recovery action; otherwise proposes exactly ONE gap by the fixed order safety_evidence > user_ux > automation > fleet > polish (ties by stable input order). Cycle ledger `appendCycleLedger` → `evidence/loop-cycles/cycle-<n>.json` {decision, timestamp, workbook_phase, chosen_gap} AND event-sources `planner.cycle_planned` so `rebuildCycleLedgerFromEvents` reproduces the on-disk ledger (GR#5, tested). GR#8 kept: zero child_process in daemon src (eslint static guard stays green).
- Shell `scripts/loop-planner.ts` (`pnpm loop:plan`): gathers REAL inputs — `git status --porcelain`, WORKBOOK_v6 §0 yaml block, root-workbook SoT scan, budget via `checkHeadlessBudget` against `$AEDEV_HOME/state.db` when present (else default-allow with explicit `no-db` note), holds = max(db active holds, §0 open_holds), previous-cycle gate fail-closed unless `AEDEV_LOOP_PREV_PR_MERGED=1`, `pnpm test` actually run unless operator-asserted via `AEDEV_LOOP_TESTS_GREEN`. Prints a PlanCard-shaped JSON + human text, writes the ledger entry, and STOPS — it never implements, never pushes, never merges (GR#10).
- **First real run committed as evidence**: `evidence/loop-cycles/cycle-1.json` + full output — on a clean tree with the suite green it PROPOSED `v6-p3-real-proof-closeout` (top safety_evidence priority), i.e. the planner correctly points at the operator-gated V6-P3 closeout instead of inventing automatable work.
- **V6-P5 soak ops**: `docs/operations/SOAK_OPERATIONS.md` — exact one-week command (`AEDEV_SOAK_MS=604800000 pnpm test:fleet:soak`), launchd plist (mirrors `scripts/launchd/` direct-node pattern, KeepAlive crash recovery), evidence dir contract (`evidence/fleet-soak/<ts>/`), one-step resume, failure-recovery table, ntfy wiring (notify-pr-ready.sh pattern; hold pushes already via watchdog), report classification template (GR#7). `soak-pending.json` artifact: `packages/daemon/src/soak-status.ts` (5 tests: build/derive/sticky-terminal/roundtrip/fail-closed reader) + `scripts/soak-status.ts` CLI (`pnpm soak:status [start|complete|fail]`); `running` past `expected_end` honestly reads `overdue`, never silent-completes.
- Gates: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 889 passed, 6 skipped (130 files; +25 over the 864 baseline, zero regressions).
- §0 → `current_phase: V6-P6`. Honesty (GR#7): V6-P4/P5 are **code complete**; V6-P3 real proof stays operator-gated (real Draft PR URL + real Gemini verdict still pending on the operator Mac — exactly what cycle-1 proposes); the one-week soak itself remains **unproven** until its evidence lands.

## s_v6_0002 · 2026-06-11 · V6-P2 complete · card cockpit (UI renders the five loop cards)

- New `apps/dashboard/src/pages/cockpit/LoopCard.tsx` (TDD: 13 component tests first): renders exactly the five GR#11 card types from `overview.operatorView.card`; calm bilingual copy; `next_step` is always the prominent first row (`cockpit-loop-card-next-step`); the `machine` sub-object is never visible text — raw codes live only in `data-card-type` / `data-user-state` / `data-machine-stage` / `data-hold-code` / `data-pr-gate-code`. Blocker card shows `human_explanation` + `why_it_matters` + recovery actions, zero raw codes.
- Mounted in `Cockpit.tsx` above the chat as the primary state surface. Before a mission exists (brainstorm/clarify), an honest client-side UnderstandingCard keeps the same five-card mental model (questions + recommended defaults from the pending clarification; no fabricated machine state; session holds keep their dedicated banner). All pre-existing testids unchanged.
- `scripts/operator-cockpit-user-e2e.ts` extended: every journey step now also asserts the loop card is present with the EXPECTED type — understanding during clarify (steps 2–3), plan at roadmap_ready (step 4), progress during execution (step 5), blocker at the Draft PR gate (step 7) — plus non-empty `next_step` visible without logs and no machine token inside the card's visible text. All previous assertions kept.
- Browser evidence (real chromium, mock/template env — simulated planner/worker, real UI): user-journey E2E PASS 7/7 at `evidence/browser-cockpit-user-e2e/2026-06-11T01-52-49-157Z/`; quality smoke PASS at `evidence/browser-cockpit-quality/2026-06-11T01-53-12-152Z/`.
- Gates: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 864 passed, 6 skipped (128 files; +13 over the 851 baseline, zero regressions).
- §0 → `current_phase: V6-P3`（真实证明收口）。L1 of V6-P2 met: "不读日志即知下一步" now has browser-level evidence; the old loop summary stays as a read-only evidence detail in the thread footer, no longer the primary state surface.

## s_0013 · 2026-06-10 · operator-reported real-chain regression PASS (closed-gate) · P4 still pending open-gate run

- Operator ran a real Mac E2E against `hermus-agent` (temp clone): planner=`claude-cli/local_claude_code`, coder=`codex-cli/local_codex`, **Gemini verdict `pass`** persisted to `validator-summary.json`, Draft-PR gate blocked with `REMOTE_WRITES_DISABLED`; no push, no PR URL, no merge; hermus-agent itself untouched. Report (operator machine): `evidence/launch/operator-cockpit-real-smoke-2026-06-10T07-06-36-411Z.md`. Operator gates green locally.
- Provenance note (GR#7): the operator's checkout predates PR #31–#33 (688 passed / 115 files vs main's 704/118 and this branch's 711/119), so the run exercised the **v1 chain** — no P2 Claude-review round, no P4 whitelist. It is recorded as a valuable closed-gate regression of the real planner/coder/validator chain, **not** as the P4 exit.
- Operator also patched `scripts/operator-cockpit-real-smoke.ts` locally (Gemini verdict into the main report + `validator-summary.json` persistence); patch + evidence still live on the operator machine and should be pushed into this branch.
- P4 exit unchanged (`blocked_on: operator_real_e2e`): merge PR #33 → pull main → `AEDEV_ALLOW_REMOTE_WRITES=1` + `AEDEV_REMOTE_WRITE_WHITELIST=hermus-agent` → rerun → real Draft PR URL + evidence → mark §0 done.

## s_0012 · 2026-06-10 · v4-P4 implementation complete · real E2E pending on operator Mac

- GR#3 revision implemented: `DraftPrGateConfig` now requires `remoteWriteWhitelist: string[]` (compile-time enforcement at every construction site) and the gate throws the new `REPO_NOT_WHITELISTED` before push for any repo off the list — empty list blocks every repo even when `allow_remote_writes` is true (fail-closed). Gate order: global flag → whitelist → repo.enabled → forbidden paths.
- `remote-write-policy.ts`: new `remoteWriteWhitelist(stateDir)` reader — `AEDEV_REMOTE_WRITE_WHITELIST` (comma-separated) wins over the `remote_write_whitelist:` block/inline list in the known config.yaml locations; default empty.
- Wired through all production sites: daemon server executor, scheduler dispatch executor, and the cockpit `create-pr` route (the no-write probe gate now also carries the whitelist, so a non-whitelisted repo blocks with the precise code instead of a generic one).
- Tests: +3 gate tests (non-whitelisted blocked despite global flag; empty list blocks; flag-off wins) and +4 policy reader tests (fail-closed default, env precedence, yaml block list, inline list); the two server create-pr success-path tests now set the whitelist explicitly, proving the double gate end to end. Existing regression intact: Gemini non-PASS still blocks create-pr.
- Operator runbook added: `docs/operations/P4-first-real-draft-pr.md` (open the double gate for one safe repo, run the full clarify→code→review→Gemini→Draft-PR chain, L1 checklist incl. a ≥3-tick idle soak with zero `cost.headless_call`, rollback notes).
- Gates: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 711 passed, 6 skipped (119 files; +7 new).
- §0 `blocked_on: operator_real_e2e` — the phase closes only when a real Draft PR URL + evidence land from the operator's Mac (this cloud container has no subscription CLIs or real repo access by design).

## s_0011 · 2026-06-10 · v4-P3 complete · 24/7 watchdog

- Added `packages/daemon/src/watchdog.ts`: tick loop (default 30 min, `AEDEV_WATCHDOG_TICK_MINUTES`) that is **zero LLM calls by construction** — it only reads the event store. Three duties per tick: (1) hold events (`operator.hold_created` / `mission.run_held`) not yet seen → one ntfy each, deduped forever via `watchdog.hold_notified` keyed by source event id (timestamp-independent, restart-safe; the first tick marks pre-existing holds as seen WITHOUT notifying); (2) `running` missions with no event activity past `AEDEV_WATCHDOG_STALE_MINUTES` (45) → one notification per mission ever (`watchdog.stale_notified`); (3) nightly Memory Compiler — once per calendar day at/after `AEDEV_WATCHDOG_COMPILE_HOUR` (2), Tier-2 lessons compile into each repo's Tier-1 `cowork-memory.md` (fixes the v3-P5 "每晚" deviation). Every tick appends `watchdog.tick`, so the window is event-sourced (GR#5).
- Extracted `packages/daemon/src/ntfy.ts` (`sendNtfy`) shared by the P1 budget guard and the watchdog; notification failure never blocks the state change.
- Daemon wiring: `autoStartWatchdog` (default true) + `watchdogTickMinutes` in `DaemonConfig`; the stop signal interrupts the tick sleep so shutdown never waits out a 30-minute window.
- Knobs documented in `config/default.yaml` + `.env.example`.
- Gates: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 704 passed, 6 skipped (118 files; +5 watchdog tests: quiet tick is silent + zero LLM, hold notify-once, stale dedupe, nightly compile once-per-day + Tier-1 update, interruptible stop).
- Next: P4 per-repo whitelist remote-write exit; first real Draft PR on the operator-designated safe repo.

## s_0010 · 2026-06-10 · v4-P2 complete · cross-engine review loop

- Added `packages/daemon/src/claude-reviewer.ts`: `MissionReviewer` contract, `ClaudeReviewer` (headless claude over the evidence bundle ONLY — PRD/diff/logs selected by `selectReviewEvidence`, never the coder conversation), strict `parseReviewVerdict` (`{verdict, findings[], confidence}`; rework-without-findings and unparseable output are rejected, GR#7), and `ReviewBlockedError` carrying a hold code. Review calls go through the P1 budget guard (checked before spawn, recorded as `cost.headless_call` with role=reviewer after).
- MissionRunner: new 3a review stage between evidence bundling and validators. `approve` → straight to the Gemini gate (GR#9: review never replaces the final judge). `rework` → repair task (`Rework <n>` with the findings appended to the original contract) re-runs the coder and re-imports evidence; cap `AEDEV_BUDGET_MAX_REVIEW_CYCLES` (default 2) → over cap returns a held mission with `HOLD-REVIEW-LOOP`; blocked/unstructured review holds with the carried code (HOLD-BUDGET / HOLD-REVIEW-STRUCTURE). Events: `review.requested` / `review.verdict` / `review.rework_started`; evidence: `claude-review-<n>.json` per cycle.
- Cockpit wiring: real (non-mock) operator missions construct `ClaudeReviewer` with the session as budget key, and every verdict is pushed into the conversation as a bubble (`renderReviewVerdictBubble`); mock/test mode skips review so existing flows are unchanged.
- Knob documented in `config/default.yaml` + `.env.example` (`AEDEV_BUDGET_MAX_REVIEW_CYCLES=2`).
- Gates: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 699 passed, 6 skipped (117 files; +13 new tests: 8 reviewer, 5 runner-loop).
- Next: P3 24/7 watchdog — tick scheduler (zero idle LLM calls), nightly Memory Compiler, hold → ntfy.

## s_0009 · 2026-06-10 · v4-P1 complete · Agent SDK credit guard

- Added `packages/cost-meter/src/headless-budget.ts` (pure): per-mission/per-day verdict logic, env parsing (`AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION` default 15, `AEDEV_BUDGET_MAX_HEADLESS_PER_DAY` default 60; 0 disables), and HOLD reason text. 7 unit tests.
- Added `packages/daemon/src/headless-budget-guard.ts`: counts `cost.headless_call` events straight from the event store (UTC-day window — GR#5 rebuildable), records every spawned `claude --print` (success or failure both consume credit), and on a block creates exactly one active `HOLD-BUDGET` per session plus `operator.hold_created` / `operator.notify_requested` events and an optional ntfy push (`AEDEV_NTFY_TOPIC`/`AEDEV_NTFY_URL`). 5 unit tests.
- Wired the guard into every daemon headless-claude path: `runLocalPlannerText` (brainstorm + followup), `runPlannerMissionDesign` (fixture/template paths stay free), and the claude-cli worker-discovery probes at all three `discoverWorkerSessions` call sites (recorded only when the probe actually ran, via `probeStatus`). Budget is checked BEFORE spawning; blocked planner rounds return a visible HOLD bubble with `holdCode: HOLD-BUDGET`.
- Cockpit status strip now shows today's metered call count (`headlessCallsToday` on the operator mission view; `data-testid="cockpit-headless-calls"`).
- Documented the knobs in `config/default.yaml` (env is authoritative) and `.env.example`.
- Gates: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 686 passed, 6 skipped (115 files; +12 new budget tests). No silent API fallback paths added (GR#1/#6 intact).
- Next: P2 cross-engine review — Claude reviews Codex diff + failing logs with a structured verdict and a capped rework loop (`budget.max_review_cycles`).

## s_0008 · 2026-06-09 · v4-P0 complete · doc reconciliation + dead-code cleanup

- Archived `WORKBOOK_v3.md` and `PRODUCTION_WORKBOOK.md` into `archive/` with SUPERSEDED headers; `WORKBOOK_v4.md` is now the only root file claiming SoT (L1 grep verified). Added OBSOLETE banners to `docs/roadmap.md` (kept in place — `config/default.yaml` scopes roadmap-agent to it) and `docs/aedev-prototype-status.md`.
- Rebuilt the `CLAUDE.md` module map from the real tree: 12 product packages + dashboard and 13 parked packages, all 25 accounted for (L1 consistency check passes both directions). Fixed the CLI section: the command surface is `aedev` (status/repo/task/mission/doctor), not `claude247`.
- **Correction to the s_0007 audit:** `cost-meter`, `event-log`, `preview` are direct `packages/daemon` dependencies and `claude247-bridge` is a `packages/runner` dependency — they are wired, not orphans, and went into the module map product group instead of PARKED. Only `roadmap-agent` and `secrets` were truly unlisted orphans; both added to `docs/PARKED.md`.
- Rewrote `AGENTS.md` (out of P0's literal list but squarely its intent): it still described the deleted Python tree (`orchestrator/`, FastAPI+HTMX, `~/.Codex-247/`) and pointed Codex at the archived `EXECUTION_WORKBOOK.md`. Now mirrors CLAUDE.md with the v4 banner. Updated README's two stale `WORKBOOK_v3.md` links.
- Removed dead cockpit components (`Sidebar.tsx`, `Observation.tsx`, `CommandPalette.tsx`, `ExecutionTimeline.tsx`) and the orphan `ExecutionTimeline.test.tsx`; fixed the stale `operator.ts` plan_scale comment/note that contradicted the implemented P6 per-node DAG path.
- Gates: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 674 passed, 6 skipped. (First run showed 13 failures in worktree/clone tests — root-caused to the remote container's global commit-signing config breaking `git commit` in temp fixture repos; reran with a signing-free `GIT_CONFIG_GLOBAL` for test child processes. Environmental, not a code issue.)
- Remote writes, pushes, merges, `.env`, and secrets untouched. Next: P1 Agent SDK credit guard (extend cost-meter: per-mission/per-day headless call budget, HOLD-BUDGET + ntfy).

## s_0007 · 2026-06-09 · v3→v4 gap audit + WORKBOOK_v4 created (negotiated with operator)

- Full audit of WORKBOOK_v3 "P0–P7 complete" claim against the code tree: **largely true** — every phase has real implementation, tests, and evidence. Caveats: P5 Memory Compiler runs at Gemini-block time, not nightly (no scheduler); P7 ran in a temp sandbox repo with worker terminal state `paused`; dashboard keeps dead cockpit components; `operator.ts:1304-1311` comment contradicts the implemented P6 DAG path.
- Documentation drift found: `PRODUCTION_WORKBOOK.md` still claims canonical (dual SoT); `CLAUDE.md` module map lists 7 of 25 packages and omits product-critical `packages/memory`; `docs/roadmap.md` + `docs/aedev-prototype-status.md` are obsolete and contradict reality; `docs/PARKED.md` misses 6 orphan packages.
- External-date risks assessed: 2026-06-15 `claude -p` moves to a separate Agent SDK monthly credit — directly affects this system's core headless invocation path (`claude-adapter.ts` uses `claude --print`); 2026-06-18 Gemini CLI sunset does **not** affect the validator (it calls the Gemini REST API).
- Operator decisions (negotiated): keep engine split (Claude=planner/reviewer, Codex=coder; role flip rejected); add a cross-engine review step (Claude reviews Codex diffs); keep headless + add a credit budget guard (interactive/Computer-Use driving rejected as fragile); proceed with the P0–P4 v4 skeleton; open `allow_remote_writes` for one whitelisted safe repo in P4.
- Created `WORKBOOK_v4.md` as the new SoT (P0 doc reconciliation, P1 credit cost guard, P2 cross-engine review, P3 24/7 watchdog + nightly compiler, P4 real Draft-PR exit). Added SUPERSEDED banner to `WORKBOOK_v3.md`; updated `CLAUDE.md` banner to v4. Full archival of v3/PRODUCTION_WORKBOOK happens in v4-P0.
- Docs-only session: no code touched; typecheck/lint/test gates deferred to the first v4-P0 work session.

## s_0006 · 2026-06-03T17:08:05Z · P7 complete · validated end-to-end

- Fixed the final P7 validator gap: cockpit missions now run the configured Gemini API validator directly for the Gemini-only hard gate instead of routing it through the local worker-family separation path.
- Tightened the real smoke so it waits for validator completion before attempting Draft PR, and skips unrelated local CLI session probes during strict cockpit smoke when requested.
- Strict real E2E PASS with secrets-injected Gemini: Claude planner reached `brainstorm_ready`, roadmap was generated, Codex executed as `codex-cli` with `local_codex`, Gemini validation completed, and Draft PR creation was blocked only by `REMOTE_WRITES_DISABLED`. Report: `evidence/launch/operator-cockpit-real-smoke-2026-06-03T17-03-35-037Z.md`.
- Real browser validation PASS: the in-app browser loaded the cockpit at `127.0.0.1:7248`, verified the thin status strip, verified legacy sidebar/inspector/tabs/Project Pulse were absent, and captured screenshot evidence at `evidence/browser-cockpit-quality/p7-in-app-browser-2026-06-03T17-verified.png`.
- Browser quality smoke PASS after the P7 fixes: `pnpm test:cockpit:quality-smoke`, evidence at `evidence/browser-cockpit-quality/2026-06-03T17-05-39-693Z/`.
- Validation: `pnpm --filter @aedev/daemon typecheck` PASS; `pnpm lint` PASS; focused mission-runner/server/worker-session-discovery tests PASS (53 tests); `pnpm test` PASS with 114 files, 676 passed, 6 skipped.
- External AI validation: Gemini evidence-only verdict `PASS`, confidence 1.0, no blockers, no residual risks.
- P0-P7 state: complete. Remote writes, pushes, PR creation, merges, `.env`, and secrets remained untouched.

## s_0005 · 2026-06-03T16:08:00Z · P7 clarify transport fixed · Gemini pending

- Fixed the P7 clarification transport bug: `operator.questions_answered` now records the original question text with each answer, and planner follow-up prompts include the full clarification transcript before asking Claude to reassess confidence.
- Removed the fixed “ask exactly 3 questions” contract from backend prompts, choices, HOLD text, and the Cockpit composer. Claude may now ask zero, one, or many remaining questions until it judges confidence ≥95.
- Updated real-smoke auto-operator answers to respond from actual question text semantics, not only abstract `field` values.
- Validation: `pnpm --filter @aedev/daemon typecheck` PASS; focused `operator-ux` + `server` tests PASS (30 tests); `pnpm lint` PASS.
- Strict real-smoke rerun improved: Claude reached `brainstorm_ready`, generated the roadmap, Codex ran as `codex-cli` with `local_codex`, repo-bound workspace evidence was captured, and worker finished. New blocker: Gemini validator remained pending / did not produce PASS before Draft PR gate. Report: `evidence/launch/operator-cockpit-real-smoke-2026-06-03T16-05-47-295Z.md`.
- Next: fix validator execution/persistence so configured Gemini produces an evidence-only PASS/FAIL before `create-pr`.

## s_0004 · 2026-06-03T15:47:00Z · P3-P6 complete · P7 blocked

- P3 completed: `apps/dashboard/src/pages/Cockpit.tsx` is now a single conversation column plus a three-part thin status strip; legacy sidebar/Project Pulse/inspector/tabs are no longer rendered. Browser quality smoke PASS with screenshots at `evidence/browser-cockpit-quality/2026-06-03T15-30-30-196Z/`.
- P4 completed: default validator factory is Gemini-only; `/operator/sessions/:id/create-pr` now hard-blocks unless the latest evidence-only Gemini verdict is PASS, emits `operator.gemini_pr_blocked`, and writes the Gemini verdict back into the operator conversation. Focused P4 tests PASS.
- P5 completed: added `packages/memory/` with Tier1 repo/operator memory files, Tier2 event projection from Gemini rejection events, Memory Compiler promotion into repo memory, `SemanticMemory` seam, worker prompt injection, and replay tests.
- P6 completed: MissionRunner now keeps small tasks on the single-run path and routes large `task-dag.json` plans (`>6` nodes) through per-node execution with node evidence; node failure returns mission failed/BLOCKED rather than fake-pass. Focused DAG tests PASS.
- P7 attempted strict real E2E with secrets-injected Gemini and live local planner/coder (`AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1=1`, `AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI=1`). It failed honestly before execution: real Claude clarification did not reach 95% before timeout despite automated answers. Latest report: `evidence/launch/operator-cockpit-real-smoke-2026-06-03T15-40-31-515Z.md`.
- Validation: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 114 files, 675 passed, 6 skipped; `pnpm test:cockpit:quality-smoke` PASS.
- External AI validation: Gemini evidence-only verdict `PARTIAL`; it agreed P3-P6 are acceptable and P7 must remain FAIL/BLOCKED.
- Next: fix planner follow-up/clarification convergence so strict P7 reaches ≥95%, then rerun real smoke through Gemini PASS and remote-write-off Draft PR block.

## s_0003 · 2026-06-03T15:20:00Z · P2 complete

- Implemented the 95% understanding gate in `packages/daemon/src/routes/operator.ts`: planner clarification JSON now supports `{questions, confidence, rationale}` while preserving old array parsing; `clarify.round`, `clarify.confidence`, and one-time `clarify.unlocked` events are emitted.
- `generate-roadmap` and `start` now run the same server-side gate and return `409 CLARIFY_GATE_BLOCKED` while confidence is below 95 or latest planner questions remain unanswered. Answering questions no longer auto-unlocks when confidence is still low.
- Overview now reads confidence from `clarify.confidence` events and shows latest pending questions; `clarifying` maps to the understanding stage.
- Added fixture-backed L1 tests: ambiguous fixture starts at 62% with a pending question, blocks both roadmap and start, remains blocked after the answer, then unlocks only after a second planner round at 96%; clear fixture at 97% generates a roadmap immediately.
- Validation: focused P2 tests PASS (4 files, 38 tests); `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 113 files, 671 passed, 6 skipped.
- External AI validation: Gemini evidence-only PASS, confidence 1.0, no blockers or residual risks.
- Next: P3 conversational UI rewrite: one chat stream, thin status bar, inline clarification/progress/diff/Gemini cards, and browser quality smoke.

## s_0002 · 2026-06-03T15:15:00Z · P1 complete

- Fixed the engine split: planner defaults to Claude CLI only; Codex is rejected as planner with a visible P1 HOLD; local coding now requires a healthy Codex CLI session and no longer switches to Claude for dual-validator work.
- Evidence now records local auth modes: planner events include `provider=claude-cli` / `authMode=local_claude_code`; worker cost/model-usage evidence includes `provider=codex-cli` / `authMode=local_codex`.
- Updated router/merge behavior and docs: `WorkerPoolRouter` planner=`claude-cli`, coder=`codex-cli`; Codex-authored dual-validator work stays Codex and waits when validator-family independence is not satisfied; install docs and superseded ADR-0017 reflect P1.
- Real non-mock smoke: `AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1=1 pnpm test:cockpit:real-smoke` PASS. Report: `evidence/launch/operator-cockpit-real-smoke-2026-06-03T15-06-56-025Z.md`; worker evidence copied beside it. The report recorded planner=`claude-cli` auth=`local_claude_code`, coder=`codex-cli` auth=`local_codex`, no PR URL, and draft PR blocked by `REMOTE_WRITES_DISABLED`.
- Validation: focused P1 tests PASS (4 files, 57 tests); `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 113 files, 668 passed, 6 skipped.
- External AI validation: Gemini evidence-only PASS, confidence 1.0, no blockers or residual risks.
- Next: P2 95% understanding gate, making Claude clarification confidence a hard server-side unlock condition before roadmap or coding.

## s_0001 · 2026-06-03T06:44:52Z · P0 complete

- Completed P0 reality alignment and safety lock: `CLAUDE.md` now reflects the TS monorepo and `~/.aedev`; `EXECUTION_WORKBOOK.md` was archived; `docs/PARKED.md` lists parked experimental packages.
- Added no-paid-api guard coverage and wiring: daemon guard, runner child-env sanitization, Codex paid-key stripping, safe worker discovery in mock mode, and Gemini validator visibility in mission overview.
- Kept `.env`, secrets, remote writes, pushes, PRs, and merges untouched.
- Validation: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS with 113 files, 666 tests passed, 6 skipped.
- External AI validation: Gemini evidence-only rerun PASS after supplying standard evidence filenames.
- Next: P1 engine split, fixing planner to Claude CLI and coder to Codex CLI with evidence-visible provider roles.
