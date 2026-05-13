# BACKLOG.md

> Ordered list of next L7 tracks. Each cycle picks the highest-priority
> *capable* item (prerequisites met). Mark complete with DONE in <CYCLE_ID>;
> mark dropped with strikethrough + reason. Never silently delete.
>
> See §6 of `AUTODEV_L7_MASTER_PROMPT.md` for the canonical track roadmap
> and §4 Step 4 for the picker logic.

## P0 — immediate next cycle (Phase B of AUTODEV_L7_CONTINUOUS_RUN.md)

- [x] [Phase B Cycle 25] scripts/autodev_continuous_cycle.sh
      DONE in 20260513-050612 (launchd wake script + 15 regression tests;
      all stop conditions covered; macOS+Linux mtime compat; always exits 0)

- [x] [Phase B Cycle 26] scripts/autodev_cycle_prompt.md
      DONE in 20260513-051327 (the standing prompt fed to `claude -p`
      on every launchd wake; 27 structural tests; encodes Cycle 25's
      propose-before-check ordering lesson)

- [x] [Phase B Cycle 27] scripts/install_launchd_continuous.sh
      DONE in 20260513-051843 (L7 launchd plist installer + 26 tests;
      flags: --install/--uninstall/--status/--print-plist; idempotent;
      AUTODEV_LAUNCHD_DRY_RUN env knob for test path; label
      `com.lanston.autodev.continuous` is distinct from the v3
      `com.autodev.supervisor` agent so they coexist)

- [x] [Phase B Cycle 28] scripts/autodev_status_dashboard.sh
      DONE in 20260513-052318 (read-only operator dashboard with 7
      sections + 28 tests + doctor extension to 13 checks; surfaces
      both L7 and v3 launchctl agents)

- [x] [Phase B Cycle 29] foreground smoke test of the continuous infra
      DONE in 20260513-052713 (tests/test_autodev_continuous_cycle_smoke.py
      with 7 multi-wake scenarios exercising the full state machine;
      Phase B 5/5 COMPLETE — launchd infra ready for operator install)

## P0.5 — Phase C handoff documentation (next 2 cycles)

- [x] [Phase C Cycle 30] reports/L7-handoff-to-launchd.md
      DONE in 20260513-053023 (10-section operator handoff + 27
      structural tests; cites L7 installer path correctly)

- [x] [Phase C Cycle 31] reports/milestone-3.md
      DONE in 20260513-053421 (final session milestone per L7 §18;
      9 sections + 26 structural tests; Phase C 2/2 COMPLETE)

## P0.75 — Phase D (opportunistic; uses remaining session context)

Drive real disciplined cycles for the C streak (currently 14/30).
Each cycle:
- Picks via `propose_next_track.py` (already selects Track C3-live)
- Or a small P1/P2 track that's capable and ≤45 min
- Always: rollback tag, PLAN, preflight, TDD, atomic commit
- Always: bump streak_after by 1 in cycle-history.jsonl
- Stop when session context approaches ~80% full OR cycle budget
  exhausts; then write reports/session-handoff-<ts>.md and exit

- [x] [Cycle 33 — FAIL-0009 fix] env-var-gated suppression of
      cli-executor `_log()`; corrects mis-attributed root cause in
      FAILURES.md; unblocks launchd's "git status clean" check
      DONE in 20260513-141046 (4 regression tests; pytest no longer
      dirties reports/session-log.md)

- [x] [Cycle 34 — Track S5] Adversarial subagent return-check
      DONE in 20260513-141553 (whitelist + silent remap + contract
      validator + 12 tests)

- [x] [Cycle 35 — S-L7 evidence] orchestrator/adversarial_return.py
      DONE in 20260513-142134 (canonical-path shim so compute_level
      counts the gate; LEVEL.md S-evidence now 6/7 active gates +
      4 canonical-path tests)

- [x] [Cycle 36 — Track S6] orchestrator/canary_scan.py
      DONE in 20260513-142439 (last S-L7 gate; CANARY_PATTERN + 3
      public functions + 14 regression tests; LEVEL.md S-evidence
      now 7/7 active gates — no missing-module notes remain)

- [x] [Cycle 37 — Track H1] orchestrator/health.py + autodev_health.sh
      DONE in 20260513-144902 (9-signal score per §10; first real
      health.json emit = 94 green; 15 regression tests)

- [x] [Cycle 38 — H1 doctor wire] autodev_doctor.sh reads health.json
      DONE in 20260513-145451 (read-only doctor extension + 7 tests
      including 3 FAIL-0009 regression guards; doctor 13→14/0/2)

- [x] [Cycle 39 — gitignore] reports/health.{json,md,history.jsonl}
      DONE in 20260513-145929 (untracked + .gitignore'd so
      wake-refresh doesn't dirty the tree)

- [x] [Cycle 40 — wake-refresh] wake script invokes autodev_health.sh
      DONE in 20260513-150357 (fail-open + skip-env-var + -x guard)

- [x] [Cycle 41 — empirically_reproduced field] FAILURES.md schema
      DONE in 20260513-162424 (encodes Cycle 33's M-dim discipline
      rule; 11 existing entries tagged 4y/5n/1c/1na; integrity tests
      require the field on every entry going forward; Scheduler API
      used for streak update for the first time)

- [x] [Cycle 42 — prompt verify-rule] cycle prompt instructs the
      wake to check the field
      DONE in 20260513-163040 (closes the 3-cycle thread: rule
      surfaced 33 → schema encoded 41 → prompt instructs 42)

- [ ] [Track C3-live] Real-cycle worktree dispatch (priority: P1)
      details: Wire Scheduler.dispatch_next() into a real dispatch
      loop. Phase D of the continuous-run plan.
      rubric dim: C (Concurrency) — observation toward L5

## P1 — next 3 cycles

- [ ] [Track S2] Promote preflight from V4-implemented to L7-first-class-gate
      with regression-test gate matrix (priority: P1)
      details: V4 added preflight, but it's only wired into `_do_planning`.
      Make it a first-class gate alongside Guardian + TDD invariant: callable
      from any orchestrator entry point, returns structured result, has its
      own metrics counter, has a "preflight bypassed" audit event when a
      caller explicitly skips it. Document via ADR.
      prerequisites: M1 DONE. Existing preflight tests (5) pass.
      rubric dim: S (Safety gates) — preflight already counted but not
      first-class

- ~~[Track R2] Wire local Codex CLI~~ DUPLICATE — superseded by P0 entry above; the bridge code shipped in 20260512-050151. Remaining gate: user installs `codex` CLI locally (environmental, not a code change).

- ~~[Track T2] Property-based tests (Hypothesis) on V4 modules~~ DUPLICATE — completed by the three P0 sub-tracks (T2-property-billable, T2-property-preflight, T2-property-tdd-intent). T-dim moved to L4 in cycle 20260512-045843. Next T-dim move is Track T3 (mutation testing → T-L5).

- [skipped] [Track T2-original] Property-based tests (Hypothesis) on V4 modules
      (priority: P1)
      details: Add `tests/test_billable_properties.py`,
      `tests/test_preflight_properties.py`, `tests/test_tdd_intent_properties.py`.
      Hypothesis strategies for token counts, cost USD, issue body text,
      commit prefix order. Each property file >= 3 property tests.
      prerequisites: `hypothesis` package installable (likely already in deps)
      rubric dim: T (Test oracle) — moves L3 → L4

## P2 — landmark tracks (next 5-10 cycles)

- [ ] [Track E2] Implement `scripts/propose_next_track.py`
      details: Reads `FAILURES.md`, `LEVEL.md`, `BACKLOG.md` and proposes
      the next track with citations. Track outputs in
      `cycles/<id>/next-track-proposal.json`.
      rubric dim: E (Self-improvement) — moves L3 → L4

- [x] [Track H1] `orchestrator/health.py` — health score computation
      DONE in 20260513-144902 (all 9 §10 signals + 0-100 score +
      green/usable/degraded/red status + 3 output files +
      scripts/autodev_health.sh + 15 regression tests; first real
      emit against the repo: score=94 green)

- [ ] [Track P1] Strict Planner output contract enforcement
      details: Per §7 Planner contract — JSON-or-equivalent with all required
      fields. Add validation gate that rejects Planner output missing any
      field. Regression test: valid pass, missing-criteria reject, etc.
      rubric dim: cross-cuts (M + S + R)

- [ ] [Track P4] Diagnose mode implementation (`orchestrator/diagnose.py`)
      details: Per §7 Diagnose contract + §11 state machine. Triggers on
      2× CI fail / 2× Reviewer reject / repeat error signature / no progress.
      Flow: reproduce → minimize → 3 hypotheses → fix → regression test.
      rubric dim: cross-cuts (M + S + R + T)

- [x] [Track K1] `.claude/skills/` directory + 5 Wave 1 SKILL.md files
      DONE in 20260513-053857 (matt.diagnose, matt.tdd, matt.to-issues,
      matt.improve-codebase-architecture, matt.grill-with-docs;
      18 structural tests; future K2 wires these into skill_router.py)

- [ ] [Track K2] SkillRouter module + tests (`orchestrator/skill_router.py`)
      details: Per §8 — classify task type + risk, select skills.
      Pseudocode in the master prompt. Regression test covers bug routing,
      feature routing, refactor routing, high-risk escalation, unknown
      fallback.
      prerequisites: K1 DONE
      rubric dim: aux

- [ ] [Track C2] Convert orchestrator to git worktrees
      details: Single-stream → 2-stream worktree-based parallelism. Per
      §6 Track C. Risky; defer until M + S + R are at L4+.
      rubric dim: C (Concurrency) — moves L3 → L4

## P3 — long horizon (after 20+ cycles)

- [ ] [Track T3] Mutation testing (mutmut) on V4 modules, ≥80% kill rate
- [ ] [Track L1] `scripts/v5_live_sanity.sh` — one-task gated live test
- [ ] [Track S3] Intake sanitizer for prompt-injection patterns
- [ ] [Track S4] Action-layer evaluator for shell/git commands
- [ ] [Track M4] Failure auto-clustering script
- [ ] [Track R4] Adversarial Reviewer subagent role
- [x] [Track S5] Adversarial subagent return-check
      DONE in 20260513-141553 (KNOWN_FINDING_CATEGORIES whitelist +
      silent unknown→"other" remap + validate_adversarial_review_contract
      pure inspector + 12 regression tests)
- [x] [Track S6] Canary-token leakage scan
      DONE in 20260513-142439 (orchestrator/canary_scan.py with
      CANARY_PATTERN + scan_text/scan_file/scan_paths + 14 tests;
      S-L7 evidence now reads "7 active gates" — all S-L7 gates
      active, no missing-module notes remain)
- [ ] [Track L3] Long-running supervisor (`scripts/autodev_supervisor_local.sh`)
- [ ] [Track L4] launchd autostart install — only after 7 days of L2/L3 green

## Completed

- [x] [Track K1] .claude/skills/matt.*.md (5 Wave 1 stubs) +
      tests/test_wave1_skills.py
      DONE in 20260513-053857 (Phase D opportunistic streak bump;
      18 structural tests; 544 total passing tests)
- [x] [Phase C Cycle 31] reports/milestone-3.md +
      tests/test_milestone_3.py
      DONE in 20260513-053421 (final session milestone per L7 §18;
      9 sections + 26 structural tests; 526 total passing tests)
- [x] [Phase C Cycle 30] reports/L7-handoff-to-launchd.md +
      tests/test_l7_handoff_doc.py
      DONE in 20260513-053023 (10-section operator handoff + 27
      structural tests; 500-test milestone)
- [x] [Phase B Cycle 29] tests/test_autodev_continuous_cycle_smoke.py
      DONE in 20260513-052713 (7 multi-wake scenarios; Phase B
      5/5 COMPLETE — launchd infra ready for operator install)
- [x] [Phase B Cycle 28] scripts/autodev_status_dashboard.sh +
      doctor extension + tests/test_autodev_status_dashboard.py
      DONE in 20260513-052318 (read-only 7-section operator dashboard
      + 28 tests + doctor now 13/0/2)
- [x] [Phase B Cycle 27] scripts/install_launchd_continuous.sh +
      tests/test_install_launchd_continuous.py
      DONE in 20260513-051843 (L7 plist installer + 26 tests;
      coexists with pre-existing v3 install_launchd_autodev.sh)
- [x] [Phase B Cycle 26] scripts/autodev_cycle_prompt.md +
      tests/test_autodev_cycle_prompt.py
      DONE in 20260513-051327 (standing prompt for `claude -p` on
      each launchd wake; 27 structural tests; Cycle 25 ordering
      lesson encoded)
- [x] [Phase B Cycle 25] scripts/autodev_continuous_cycle.sh +
      tests/test_autodev_continuous_cycle.py
      DONE in 20260513-050612 (launchd wake script + 15 tests;
      all stop conditions covered; always exits 0)
- [x] [Track E7] retro-cite next-track-proposal in 5 cycle REPORTs +
      🎯 on dim-max CHANGELOG lines + tests/test_e_level_promotion_evidence.py
      DONE in 20260513-050048 (E-dim L6 → L7, **E is now at max** —
      Phase A complete: M=S=R=T=E=7, only C remains)
- [x] [Track T7] tests/golden/ + tests/test_golden_diff.py + 
      scripts/update_goldens.sh + tests/test_update_goldens.py
      DONE in 20260513-045716 (T-dim L6 → L7, **T is now at max**)
- [x] [Track T6] scripts/v5_live_sanity.sh + reports/live-sanity/ + doctor
      extension + HUMAN_CONFIG safety flag + 8 tests
      DONE in 20260513-045243 (T-dim L5 → L6)
- [x] [Track R7] orchestrator/review_panel.py N-of-3 panel + 12 tests
      DONE in 20260512-082125 (R-dim L6 → L7, **R is now at max**)
- [x] [Track C3-init] Scheduler.dispatch_next + record_cycle_success +
      current_zero_deadlock_streak + 10 new tests + milestone-2.md
      DONE in 20260512-081718 (streak counter in place at 1; C stays L4)
- [x] [Track R6] runner/roles/adversarial_reviewer.md + orchestrator/adversarial_reviewer.py + wired into _do_review + 12 tests
      DONE in 20260512-081235 (R-dim L5 → L6)
- [x] [Track T5] scripts/mutate_billable.py homegrown mutator (26 tests) +
      tests/test_billable_mutation_anchors.py (7 anchor tests) → 21/21
      mutants killed on orchestrator/billable.py (kill rate 100%)
      DONE in 20260512-080004 (T-dim L4 → L5)
- [x] [Track C2-init] scripts/spawn_worktree.sh + orchestrator/scheduler.py skeleton + 2nd worktree + 15 tests
      DONE in 20260512-074343 (C-dim L3 → L4; **OVERALL L=4** 🎯)
- [x] [Track R3] Wire codex_reviewer into orchestrator/main.py:_do_review + 7 tests
      DONE in 20260512-073953 (R-dim L4 → L5, production-wired)
- [x] [Track R-Phase1] Codex cost calibration: budget guard + ADR-0008 + GO verdict
      DONE in 20260512-072615 (R-dim L3 → L4, infra ready)
- [x] [Track E3] propose_next_track.py emits considered_failures + 2 new tests
      DONE in 20260512-052118 (E-dim L5 → L6)
- [x] [Track M5] widen _count_planner_refusals regex; 5 new tests
      DONE in 20260512-051659 (M-dim L6 → L7, max)
- [x] [Track S4] orchestrator/action_evaluator.py + 14 tests
      DONE in 20260512-051335 (S-dim L6 → L7, 5th of 7 safety gates)
- [x] [Track S3] orchestrator/intake_sanitizer.py + 11 tests
      DONE in 20260512-050827 (S-dim L5 → L6, 4th of 7 safety gates)
- [x] [Track M3] scripts/cluster_failures.py + reports/failure-clusters.md + 11 tests
      DONE in 20260512-050542 (M-dim L5 → L6)
- [x] [Track R2] orchestrator/codex_reviewer.py + 12 mock-tested tests
      DONE in 20260512-050151 (R stays L3 honestly until codex CLI installed)
- [x] [Track T2-property-tdd-intent] tests/test_tdd_intent_properties.py (7 props)
      DONE in 20260512-045843 (T-dim L3 → L4, 3rd of 3 property modules)
- [x] [Track T2-property-preflight] tests/test_preflight_properties.py (9 props)
      DONE in 20260512-045610 (2 of 3 property modules for T-L4)
- [x] [Track T2-property-billable] tests/test_billable_properties.py (6 props)
      DONE in 20260512-045329 (1 of 3 property modules for T-L4)
- [x] [Track E2] scripts/propose_next_track.py + 13 regression tests
      DONE in 20260512-044832 (E-dim L3 → L4)
- [x] [Track M2.5] FAILURES.md grown from 4 → 10 entries + integrity tests
      DONE in 20260512-044425 (M-dim L4 → L5)
- [x] [Track M2] scripts/preflight_failures.py + 18 regression tests
      DONE in 20260512-043811
- [x] [Track M1] Bootstrap CONTEXT.md + ADRs 0000-0004 + FAILURES.md seed
      DONE in 20260512-042701
- [x] [Track S1] Document Guardian + TDD invariant in CONTEXT.md
      DONE in 20260512-042701
- [x] [Track R1] Document single-model Reviewer in CONTEXT.md
      DONE in 20260512-042701
- [x] [Track T1] Document unit + replay test coverage (V4 30 tests)
      DONE in 20260512-042701
- [x] [Track E1] Document manual track-selection workflow (this BACKLOG)
      DONE in 20260512-042701

## Dropped

(none yet)
