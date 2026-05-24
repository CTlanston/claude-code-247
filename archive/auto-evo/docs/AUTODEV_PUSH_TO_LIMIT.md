# Push AutoDev to its real ceiling — comprehensive plan from V3 FAIL to 24/7 medium-task drone

> **Honest framing.** This plan is the most aggressive achievable upgrade
> path for this orchestrator given current LLM capabilities. It will NOT
> turn the system into a "replace main developer" black box — that
> requires LLM-level advances that don't exist in 2026. What it WILL do,
> if every phase lands, is take **60-80% of well-specified engineering
> implementation work off a human's plate on a focused project**, with
> the human retaining: writing good issues, reviewing PRs, making
> architectural decisions, and product/UX judgment.
>
> Read this entire file first. Stop at Phase boundaries. Don't improvise.
> Each phase has clear acceptance gates. If a gate fails, surface the
> failure to the human BEFORE moving to the next phase.

## Why we're doing this

V1 found 5 critical defects → fixed.
V3 verdict: FAIL (3/12 critical fail) but **1 issue completed end-to-end** (PR #17 / safe_int) — proving the pipeline works when conditions are right. V3 surfaced 3 new issues:
1. Reviewer is too strict on per-commit TDD ordering granularity
2. Guardian reads raw `runs.cost_usd` bypassing the `_is_subscription` mask
3. No pre-flight check for impossible tasks (issue #15 asked for tests of a function that doesn't exist)

This plan addresses V3's gaps (Phase 1), hardens for 24/7 (Phase 2), expands capability (Phase 3), then validates on real workload (Phase 4).

---

## The honest ceiling (read BEFORE starting)

After every phase lands, the system will be **excellent** at:
- Adding well-spec'd utility functions / API endpoints with tests
- Fixing well-isolated bugs with reproducer tests
- Refactoring within a clear contract
- Increasing test coverage on existing code
- Writing documentation for existing code

It will be **mediocre** at:
- Multi-component features (frontend + backend + DB)
- Bug fixes where the root cause is ambiguous
- Tasks where the spec leaves design choices to the implementer
- Anything requiring a sense of "good enough" vs. "ship-worthy"

It will **fail** at:
- Product decisions (what should this app even do?)
- UX judgment (does this flow feel right?)
- Stakeholder communication (does the customer understand the trade-off?)
- True architectural choices on novel systems
- Crisis response (production incident triage)

If `auto-travel` requires the third bucket, this orchestrator is the wrong tool. Use Claude Code in interactive mode for that.

---

## Phase 1 — V4: pass the 3-cycle test cleanly

**Goal**: 3/3 issues reach `human_review` in two consecutive runs, no critical FAILs.

### 1.1 Soften Reviewer's per-commit TDD ordering

The current Reviewer (Opus, per `runner/roles/reviewer.md`) flags any `test:` commit that comes AFTER a `feat:` commit, even if the diff is "add one more edge-case test for code that's already feat-committed". V3 #14 (chunks) hit this loop.

**Fix**:
1. Edit `runner/roles/reviewer.md`:
   - Replace strict per-commit ordering with: "at least one `test:` commit must precede the FIRST `feat:` commit on this branch. Subsequent `test:` commits adding coverage are acceptable."
   - Add example: "OK: test → feat → test (adding edge cases). NOT OK: feat → test (no prior test)."
2. Add a regression test in `tests/test_reviewer_role.py` (or wherever role-prompt logic is exercised):
   - Mock a commit sequence `[test:add_chunks_tests, feat:implement_chunks, test:add_negative_n_test]`
   - Assert Reviewer's TDD check returns OK (not "reject — feat before test").
3. Run the test, ensure it fails against old prompt, passes against new prompt.

### 1.2 Eliminate Guardian phantom-spike trigger

Guardian (Opus) reads `runs.cost_usd` directly via SQLite, bypassing the `_is_subscription` mask in `metrics.json`. Under OAuth/subscription, those numbers still accumulate and trip Guardian's "token spike" rule.

**Fix — pick ONE of these two paths** (decide in writing in `reports/v4-plan.md`):

**Path A (zero at write time, recommended)**: 
- In `orchestrator/db.py:record_run`, when OAuth token detected (`ANTHROPIC_API_KEY.startswith("sk-ant-oat01-")`), force `cost_usd = 0.0` for ALL rows under subscription, not just zero-token rows.
- Lose: ability to see "what the cost would have been on API". Gain: clean Guardian view.
- Document this decision in `DEFERRED.md` so future API-mode users know.

**Path B (zero at read time)**:
- Modify `runner/roles/guardian.md` to instruct Guardian: "If `mode == cheap`, treat all `runs.cost_usd > 0` as zero. The actual spend is the OAuth subscription monthly fee, not per-token."
- Update `main.py:run_guardian` to inject `cost_mode` into the prompt or metrics blob.

Either is fine. Pick the simpler one (probably A). Add regression test that confirms Guardian doesn't recommend pause after 10 fake $1 runs in subscription mode.

### 1.3 Pre-flight feasibility check (CRITICAL for "impossible tasks")

V3 #15 asked for tests of `reverse()`, which doesn't exist in the test repo. Coder refused (correctly). System wasted ~5 min of Coder + Reviewer time before declaring blocked.

**Fix**:
1. In `orchestrator/main.py:_process_one`, after Planner produces a plan but BEFORE Coder runs, add a feasibility check:
   - Scan the plan for `target_files` and `dependency_symbols` (functions/classes the plan assumes exist)
   - For each dependency, grep the test repo's main branch for the symbol's definition
   - If a referenced symbol is missing AND the plan doesn't mention CREATING it, mark the task `failed` with `last_error="pre-flight: missing dependency <symbol>"`
   - Comment on the GitHub issue: "Pre-flight check failed: this issue references `<symbol>` which doesn't exist on `<branch>`. Either expand scope to add it OR update the issue spec."
2. Add a regression test using a mock repo where the plan references a missing function.
3. Document the new behavior in `docs/autodev-harness-v3.md`.

### 1.4 Re-run V3 test twice

After 1.1, 1.2, 1.3 land + tests green + doctor green:

```bash
# Run 1
bash AUTODEV_E2E_TEST_V3.md   # equivalent — re-execute V3 with the fixes
mv reports/e2e-verdict-v3.md reports/e2e-verdict-v4-run1.md

# Clean up V4-run1's state same way Phase 5 of V3 cleaned V1
# (drop all non-terminal tasks, close stuck issues)

# Run 2 (uses fresh issue numbers)
bash AUTODEV_E2E_TEST_V3.md
mv reports/e2e-verdict-v3.md reports/e2e-verdict-v4-run2.md
```

**Phase 1 acceptance gate**:
- Both runs print `VERDICT: PASS` (12/12 green).
- If either run is `PARTIAL` and the misses are non-critical (🟡 only): acceptable, but flag for human review.
- If either is `FAIL` (any 🔴): **STOP**. Write `reports/v4-fail-rootcause.md` with the smallest reproducible failure. Don't proceed to Phase 2.

---

## Phase 2 — 24/7 hardening (the 7 post-V3 improvements)

Reference: `AUTODEV_POST_V3_IMPROVEMENTS.md` already exists with the full plan. Execute it now. Each improvement is its own commit.

After all 7 land:
1. Run the full test suite + doctor.
2. **Do a 4-hour soak test**: leave the supervisor running unattended on a backlog of 3 small issues. Come back, verify:
   - All processed correctly
   - No phantom rows
   - No orphan containers
   - Slack got daily digest (if you wired it)
   - `reports/heartbeat.json` updated within the last 5 minutes
3. ONLY if soak test clean: install launchd.

```bash
./scripts/install_launchd_autodev.sh --install
launchctl list | grep autodev
```

Tail `reports/session-log.md` for 24 hours, watch for unexpected pauses or restarts.

**Phase 2 acceptance gate**:
- 4-hour soak test produces 3 valid PRs and 0 alarms.
- launchd-managed supervisor restarts cleanly after a manual `kill <pid>` test.
- No HOLDs in `reports/human-hold.md` from the soak window.

---

## Phase 3 — Capability expansion (the hard part)

Each sub-phase here is a real engineering investment. Do them in order. STOP at each acceptance gate.

### 3.1 Multi-file change support (medium-task threshold)

Currently the orchestrator does well on 1-2 file changes. To handle "add a feature that touches a model + a route + a test file" reliably:

1. **Planner enhancement**: instruct Planner to output a `files_to_modify` list AND a `change_dependency_graph` (which file depends on which). Update `runner/roles/planner.md`.
2. **Coder enhancement**: pass the graph to Coder, instruct it to make changes in topological order (model first, then route, then test). Update `runner/roles/coder.md`.
3. **Reviewer enhancement**: check that ALL planned files were modified, none unplanned (forbidden-path check already exists; tighten it to "ONLY the planned files").
4. **Test**: create a deliberate multi-file issue ("Add a `/health` endpoint that calls a new `health_service.check()` function defined in a new file, with tests for both") and verify 3/3 cycles.

Acceptance: 5 multi-file issues in a row all reach `human_review` clean.

### 3.2 Frontend language support (JavaScript/TypeScript)

The current pipeline assumes pytest. To handle a JS/TS test repo:

1. Add a `project_type` field to `HUMAN_CONFIG.md` (python | typescript | mixed).
2. Make `runner/roles/coder.md` and CI workflow conditional on language:
   - `python` → pytest + ruff
   - `typescript` → vitest + eslint + tsc
3. Add a new runner image variant (`claude-code-247/runner-typescript:latest`) with Node + npm/pnpm baked in.
4. Test: create a small JS issue in a fresh JS test repo, verify it reaches `human_review`.

Acceptance: 3 JS issues reach `human_review` in a JS-only test repo.

### 3.3 Add a "Product Reviewer" role (UX/quality judgment, not just TDD)

The current Reviewer checks code-level invariants. Add a SECOND Reviewer pass that judges product-level quality:
- Does the PR's commit message explain WHY the change matters?
- Does the PR title read like a human wrote it?
- Are public-facing strings (error messages, log output) clear and professional?
- For UI-affecting changes: does the diff include any user-visible breaking change without a migration note?

1. Add `runner/roles/product_reviewer.md` (Opus-level, gets the diff + commits + PR title).
2. Wire into `_process_one`: after technical Reviewer passes, run Product Reviewer. Their feedback goes to Coder as a "polish" round (max 1 round, not 3).
3. Failures don't block the PR (it still opens for human review) but the verdict appears in the PR body.

Acceptance: 5 PRs run through both reviewers, and you (the human) can read the Product Reviewer's notes and find them useful at least 3/5 times. If less, the role's prompt needs rework.

### 3.4 Inter-issue dependency tracking

For projects where issue B depends on issue A's PR landing first:
1. Allow issues to declare dependencies in body: `Depends-On: #N`.
2. Orchestrator's `ingest_issues` skips issues whose `Depends-On` is still open.
3. When the prerequisite PR lands (Coder or human merges), the dependent issue auto-promotes from skipped to queued.

Acceptance: file 2 issues with B depending on A. B remains in skipped state until A's PR is closed/merged. Then B auto-progresses.

### 3.5 Per-project cost budget

Currently cost is tracked per-day globally. For a real project with 100+ issues:
1. Add `project_budget` per HUMAN_CONFIG (USD/month equivalent and run-count cap).
2. Track cumulative `runs.cost_usd` per repo (`GROUP BY repo`).
3. If budget exhausted, supervisor pauses dispatch for that repo (others still run).
4. Slack alert at 50%, 75%, 90% of monthly budget.

Acceptance: simulate burst spend, verify orchestrator pauses correctly when budget hits 100%.

### 3.6 Cross-cycle memory (the big experiment)

The biggest LLM limitation in this system: each role call starts fresh. The Coder for issue #50 doesn't know it just refactored that module in issue #48. This causes regressions.

**Best effort** (limited by LLM context windows):
1. Maintain `reports/project-memory.md`: human-readable summary of architectural decisions, refactor history, conventions adopted.
2. Inject the last 5 entries into Planner/Coder prompts.
3. After each PR merges, auto-append a one-paragraph summary: "PR #N modified module X; chose pattern Y over Z because reason W."

This is a stretch goal. It will help marginally on related issues. It will NOT solve "the LLM made a different architectural choice in PR #50 than in PR #20" entirely — that's an LLM context limitation, not fixable here.

Acceptance: 10 consecutive issues that touch the same module show consistent stylistic/architectural choices (measured by you, manually).

---

## Phase 4 — 30-day pilot on a real subproject

After Phase 3 lands, pick a REAL subproject — NOT the full `auto-travel` app — to pilot:
- A specific feature area you'd otherwise build yourself
- 30-60 small-to-medium issues
- 1 month of unattended running (with daily Slack digests)

Track:
- **Completion rate** (issues that reach `human_review` without manual intervention)
- **Human merge rate** (PRs you actually merge after review)
- **Blocker rate** (issues that hit `reports/human-hold.md`)
- **Cycle time** (median time from issue creation to PR ready)
- **Cost** (cumulative token spend; should be ~$0 under subscription)
- **Hours saved** (your subjective estimate vs. doing it yourself)

After 30 days, write `reports/pilot-verdict.md` with the metrics + your verdict.

**Decision criteria**:
- Completion rate ≥ 80% AND human merge rate ≥ 60% AND your subjective "worth it" ≥ 7/10 → **promote to auto-travel pilot**
- Below that on any axis → **stay in small-issue mode**, don't escalate

---

## Phase 5 — IF Phase 4 passes: gradual auto-travel handoff

This is hypothetical and depends on Phase 4 outcome.

Even after Phase 4 PASS, do NOT hand auto-travel over wholesale. Instead:
1. Start with non-critical paths: utility functions, data adapters, test coverage.
2. Have a daily 15-minute review of all orchestrator PRs — you stay the merge gate.
3. Gradually expand scope as confidence builds: simple routes, then features, then refactors.
4. NEVER let it touch: auth, payments, user data handling, deployment configs.
5. Architectural decisions and product UX choices remain with you, always.

The realistic outcome at end of Phase 5 is: orchestrator handles 50-70% of implementation, you do the rest + all product/architecture work, total throughput maybe 2-3x what you'd manage solo.

That's a real, valuable result. It is NOT "replace main developer". Calling it that sets up unrealistic expectations.

---

## Hard constraints (same throughout all 5 phases)

- No `git push` to `main` of any repo, including auto-travel.
- No PR auto-merge. Ever. Human approval required.
- No paid Anthropic API while `cost.mode: cheap`.
- No `.env`, secrets, keychains, SSH keys, deployment configs touched by orchestrator.
- Phase boundaries are GATES. Don't proceed past a failed acceptance.
- If you (Claude Code) find yourself improvising beyond what's specified, STOP and check with the human.

## What "done" looks like

After Phase 4 + Phase 5, write a comprehensive `reports/state-of-system.md`:
- All 5 V1 defects + 3 V3 defects + 7 post-V3 improvements + 6 capability expansions: how each landed
- Real-world success rate from the 30-day pilot
- Specific failure modes still present (there will be some)
- Recommended scope: what to use this for, what NOT to
- Cost summary (should be ~$0 under subscription, but track actual)
- A one-paragraph "would I bet on this" verdict from you (Claude Code) AND from the human

Then stop. The system either is or isn't worth deploying further. Honest verdict.

---

## Realistic timeline

| Phase | Real wall time |
|-------|----------------|
| Phase 1 (V4 reliability) | 2-3 days of Claude Code work |
| Phase 2 (24/7 hardening) | 3-5 days |
| Phase 3 (capability expansion) | 2-4 weeks (this is the big lift) |
| Phase 4 (30-day pilot) | 30 days actual wall clock, mostly unattended |
| Phase 5 (auto-travel handoff) | 30-60 days of cautious expansion |
| **Total to "useful for auto-travel"** | **~3-4 months** |

If you (the human) don't have 3-4 months of patience for this, skip to using Claude Code interactive mode for auto-travel directly. That's faster and more reliable. The orchestrator is for OFFLOADING repetitive work after you have the project running.
