# E2E Verdict — 24/7 acceptance test

> **VERDICT: FAIL — 5 critical criteria failed (C1, C6, C8, C9, C12). The system is NOT ready for 24/7 operation as-is. Recommend stopping the long-term run and addressing the 5 architectural defects surfaced below before re-running.**

Test ran 2026-05-11 09:16:38Z → 10:31:49Z (**75m 11s**, within the 90-min budget).

---

## 1. Grader output (`scripts/e2e_grade.sh 11 12 13`)

```
[C1]   FAIL  3 PRs opened (one per issue)                       got 0/3; missing: A B C
[C2]   PASS  No PR-as-issue infinite loop                       open agent:auto PR delta=0
[C3]   FAIL  TDD ordering on A, C                               no feature PRs to inspect
[C4]   FAIL  PR A (chunks) covers 5 spec cases                  no PR A
[C5]   FAIL  PR C (safe_int) covers 6 spec cases                no PR C
[C6]   FAIL  CI green on all 3 PRs                              A=no_pr B=no_pr C=no_pr
[C7]   FAIL  PR B touches tests/ only (no src/)                 no PR B
[C8]   FAIL  No phantom-cost rows during test                   phantom_new=2 — record_run bug recurring
[C9]   FAIL  Inner engine no crash                              blocker mentions exit 4 (uncaught exception)
[C10]  PASS  Completed within 90-minute budget                  elapsed=4511s (75m)
[C11]  PASS  No dead-task reprocessing                          each issue has 1 task row + 1 shadow branch
[C12]  FAIL  All 3 issues reached terminal state                0/3 — #11=reviewing #12=reviewing #13=reviewing
═════════════════════════════════════════════════════════════════
  pass=3  partial=0  fail=9  critical_fail=5
```

Three criteria passed (C2, C10, C11). Five critical criteria failed (C1, C6, C8, C9, C12).

## 2. The three test issues

| | Issue | Title | Final task status | Shadow branch on GitHub | PR | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| A | [#11](https://github.com/CTlanston/auto-evo-playground/issues/11) | Cycle1: Add chunks(items, n) utility | `reviewing` | exists but **empty** (no new commits vs main) | none opened | Coder twice failed to push code to GitHub |
| B | [#12](https://github.com/CTlanston/auto-evo-playground/issues/12) | Cycle2: Add edge-case tests for reverse() | `reviewing` | 4 `test:` commits, CI ✅ | none opened | Real work pushed; Reviewer never invoked |
| C | [#13](https://github.com/CTlanston/auto-evo-playground/issues/13) | Cycle3: Add safe_int(s, default) utility | `reviewing` | 3 commits (1 test:, 2 feat:), CI ✅ | none opened | Real work pushed; Reviewer never invoked |

**Terminal-reach order**: empty — none of the three reached `human_review` or `failed`.

## 3. Wall-clock + cost metrics

| Metric | Value |
| --- | --- |
| Total elapsed | 4511 s (75m 11s) |
| Driver iterations | 12 (max 45) |
| Runs added during test (`runs` table) | 12 |
| Cost reported under subscription | $0 (per `_is_subscription` hotfix; phantom-cost rows still surface — see C8) |
| Phantom rows added during test | **2** (zero-token but nonzero cost — the `record_run` bug recurred under load) |
| Tasks-table row count per test issue | 1 each (C11 ✅) |
| Average wall time per test issue (effective work) | ~25 min for #12/#13 Planner+Coder+CI; #11 never made progress |

## 4. Final `reports/state.json` excerpt

```
status:                   select_new_task
current_task_id:          TASK-E2E-008
current_phase:            selected
blocked:                  True
blocker_reason:           inner engine exit 4
health_status:            warn
mode:                     cheap
live_allowed:             True
```

`blocker_reason="inner engine exit 4"` is the smoking gun for C9 — the inner engine kept crashing on an uncaught exception that propagated out of the loop body, and my supervisor never cleared the blocker state on subsequent successful cycles.

## 5. Five architectural defects surfaced by this run (in cost-of-fix order)

### Defect 1 — `latest_workflow_run_status` crashes on empty PaginatedList  🔴 hardest blocker

`orchestrator/github_client.py:141`
```python
runs = _gh().get_workflow_runs(branch=branch)
for run in runs[:1]:   # ← IndexError when branch has no workflow runs yet
    return run.conclusion or "running"
```

PyGithub's PaginatedList raises `IndexError` on `[:1]` when there are zero pages. Hit whenever a shadow branch exists with no CI runs yet (newly pushed branches, or branches without CI configured). Caused every iteration's `_do_ci_check(#11)` to crash, preventing the engine from ever reaching the Reviewer step for #12/#13.

**Fix sketch**: wrap in `try: …  except IndexError: return None`, OR change to `runs = list(_gh().get_workflow_runs(branch=branch))[:1]` (eager materialise then slice safely).

### Defect 2 — Supervisor short-circuits when backlog has no `[ ]` bullets  🔴

`autodev/supervisor.py:_execute_decision` `SELECT_NEW` path:
```python
task = backlog.next_unblocked()
if not task:
    return "no work in backlog", True       # never calls inner_engine
```

Once all bullets are marked `[.]` (in_progress) by prior iterations, the supervisor returns success without ever invoking the inner engine — even though the inner engine has dozens of GitHub issues to process. The driver loop becomes a no-op.

**Fix sketch**: always invoke `_run_inner_engine` once per cycle (with a synthetic "tick" task) when no real task is available. The inner engine has its own queue.

### Defect 3 — Supervisor never clears `state.blocked` on successful cycle  🔴

`autodev/supervisor.py:_run_inner_engine`:
```python
if result.success:
    state["current_phase"] = "tick_ok"
    return summary, True   # ← does NOT clear state["blocked"] or state["blocker_reason"]
```

Once any cycle records `blocked=True`, that flag persists forever — even when subsequent cycles succeed. C9 fails on this stale flag.

**Fix sketch**: on `result.success`, set `state["blocked"] = False; state["blocker_reason"] = None; state["repair_attempts_for_current_task"] = 0`.

### Defect 4 — `_is_subscription` hotfix only suppresses Guardian view; `record_run` double-write still happens  🔴

phantom_new=2 means even during this 75-min test, the `record_run` defect tracked by GitHub issue #6 *recurred*. The tactical hotfix in `main.py:run_guardian` (force-zero `daily_cost_usd`) hides the symptom from Guardian's alert path, but the underlying `record_run` is still inserting rows with `input_tokens=output_tokens=0` and nonzero `cost_usd`. Issue #6's root-fix (UNIQUE constraint + zero-token guard) is on the test-repo PR #10 but **was never merged into the harness repo's `orchestrator/db.py`** (acknowledged architectural debt in `AUTODEV_E2E_TEST.md`).

**Fix sketch**: cherry-pick the `db.py` UNIQUE constraint + zero-token guard from playground PR #10 onto harness `orchestrator/db.py`. This needs a SQLite migration (existing DBs lack the index).

### Defect 5 — `mirror_to_github` silently fails for newly-coded branches  🟡

`mirror_to_github failed: ... 'git --git-dir /tmp/auto-evo-playground.git push ...' returned non-zero exit status 1`. The mirror function expects a local bare repo at `/tmp/auto-evo-playground.git` to mirror from, but in this deployment the runner container's git-push goes direct to GitHub (no bare repo proxy). When the runner *also* fails to push (Coder for #11 in iter 1), `mirror_to_github` is the safety net — but it's a no-op against a missing bare repo. The two-failure window means commits get lost.

Concretely: Coder for #11 ran twice (runs 85 and 86) but no commits ever reached GitHub. The Reviewer would have rejected #11 for "no test/feat commits" if it ever got the chance.

**Fix sketch**: drop `mirror_to_github` entirely (it's a leftover from the bare-repo proxy design that never landed) OR detect-and-skip when bare repo doesn't exist OR diff the runner's local push vs GitHub and re-push if they disagree.

### Defect 6 (latent) — Backlog parser regex requires numeric task-ID suffix

Discovered when my own `TASK-E2E-A` ... `TASK-E2E-H` bullets were silently dropped by the parser. Required hot-fix to `TASK-E2E-001..008`. Not a 24/7 blocker but a foot-gun for any new task IDs.

## 6. What the test actually proved

**Worked correctly:**
- ✅ Pre-flight gating (HUMAN_CONFIG read, doctor, deps)
- ✅ Phase-A compose-stack stop (avoided dual-driver race)
- ✅ HUMAN_CONFIG → state sync from yesterday's fix
- ✅ TDD pattern on #12/#13: Planner→Coder→Push→CI green (Cycle 2/3 acceptance criteria *almost* met)
- ✅ No PR-as-issue loop (C2 passed — last session's `pull_request is None` filter held)
- ✅ Single task row per test issue (C11 — no dead-task reprocessing)
- ✅ Within 90-min budget (C10)

**Didn't work:**
- ❌ Three back-to-back live cycles (the headline acceptance bar) — supervisor's task-selection model is incompatible with multi-issue inner-engine work
- ❌ Inner-engine crash recovery (the IndexError defect halts the whole loop)
- ❌ Push reliability (Coder pushes for #11 failed twice; no safety net caught it)
- ❌ State hygiene (blocked flag persists across success)
- ❌ Phantom-cost suppression (root fix never landed in the harness)

## 7. Recommendation

**Do not start the long-running supervisor yet.** The 5 critical defects above are well-understood and individually small fixes (~1 day of focused work to address all five). After they land:

1. Cherry-pick PR #10's `db.py` UNIQUE constraint into harness (closes Defect 4).
2. Wrap `latest_workflow_run_status` in IndexError-tolerant code (Defect 1).
3. Clear `state.blocked` on successful supervisor cycle (Defect 3).
4. Either fix or remove `mirror_to_github` (Defect 5).
5. Loosen the backlog parser regex (Defect 6) — same as previous backlog manager fixes.
6. Architectural call on Defect 2 (supervisor SELECT_NEW path) — either "always tick inner engine" or "supervisor task is permanent, supervisor never short-circuits".

Then re-run this exact E2E. If all criteria pass within a fresh 90-min budget, the system is worth committing to 24/7.

---

VERDICT: FAIL — 5 critical criteria failed (C1, C6, C8, C9, C12). 3 root defects in supervisor/state, 2 in inner engine. None unfixable, but the system as-tested cannot drive 3 back-to-back issues through to human_review.
