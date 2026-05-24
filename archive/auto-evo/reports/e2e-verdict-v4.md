# V4 Verdict

## Summary

**PASS at the deterministic-acceptance bar.** All four V3-critical root causes have been closed with code changes + 30 regression tests; the full pytest suite is 97 passed / 1 skipped / 0 failed; the `autodev_doctor` is green.

- ✅ **Track 1** Guardian no longer reads raw `runs.cost_usd` under subscription — cost is zeroed at INSERT time via a single `to_billable_cost` helper, so the DB itself shows $0 and any Guardian query path agrees with `metrics.json`.
- ✅ **Track 2** Preflight detects the #15-class impossible spec ("test reverse() in src/utils.py" + "reverse() absent" + "modifying src/utils.py forbidden") and terminalises the task as `failed` BEFORE Planner runs.
- ✅ **Track 3** TDD-ordering check replaced with TDD-intent (at least one test commit AND at least one test commit precedes at least one impl commit) — accepts the #14 pattern V3 rejected; still rejects "no tests" and "all tests after all impl".
- ✅ **Track 4** `_inner_engine_has_pending_work` now honours `STATE_DIR` / `AUTODEV_STATE_DB` env vars, never falls back to the macOS read-only `/state` path, logs a clear diagnostic on DB error, and is covered by 4 tests with custom temp paths.
- ⚠️ **Live 3-issue e2e against GitHub: NOT re-run.** The V3 run consumed many hours of wakeup cycles and the deterministic replay tests below cover the same behaviour at unit-test speed. The prompt explicitly allows "the shortest deterministic version that proves the same behaviors" — that's what I used. A live run remains recommended before flipping the supervisor to 24/7 autostart, but it should be a sanity confirmation, not a discovery exercise.

## Changes Made

| File | Change | Reason |
| --- | --- | --- |
| `orchestrator/billable.py` *(new)* | `is_subscription_mode()`, `to_billable_cost()`, `load_budget_metrics()` | Single source of truth for billable vs raw cost. |
| `orchestrator/db.py` | `record_run` now calls `to_billable_cost` before INSERT | Zeros cost at source under subscription; preserves API-mode cost. |
| `orchestrator/preflight.py` *(new)* | `preflight_issue(title, body, repo_root)` returning `PreflightResult` | Catches impossible specs (symbol absent + file forbidden) before Coder runs. |
| `orchestrator/main.py:_do_planning` | Calls `preflight.preflight_issue` first; on impossible result marks task `failed` + posts Slack note + returns without invoking Planner | Wires Track 2 into the state machine. |
| `orchestrator/main.py:_check_tdd_invariant` | Replaced strict prefix-only gate with TDD-intent gate (regex-based prefixes test/tests/spec/specs/coverage; feat/fix/impl/implement/refactor; checks that *some* test commit precedes *some* impl commit) | Track 3 fix; ends the #14-style rejection on "edge-case test after impl". |
| `orchestrator/roles/reviewer.md` | TDD-ordering check #1 rewritten to TDD-intent language; "decision principles" updated to reject only the "no tests" / "all tests after all impl" cases | Aligns the model-side reviewer with the deterministic gate. |
| `runner/roles/reviewer.md` | Mirror of the orchestrator/roles/ change (this copy is baked into the runner image) | Image consistency. |
| `autodev/supervisor.py` | New `_resolve_state_db_path()` with explicit env-var precedence; `_inner_engine_has_pending_work()` uses it, raises clear log on error, never silently False | Track 4 hardening. |
| `tests/test_v4_hardening.py` *(new, 25 tests)* | Tracks 1–4 covered with focused unit tests | Regression suite. |
| `tests/test_v4_e2e_replay.py` *(new, 5 tests)* | Deterministic replay of the V3 #14 / #15 / #16 scenarios + composite | "Shortest deterministic e2e". |
| `prompts/v4-hardening.md` *(new)* | Mission text saved for the record | Per user's request. |

## Tests Run

```bash
$ python3 -m pytest tests/ -q --no-cov
....................................s....................................
..........................                                               [100%]
97 passed, 1 skipped in 0.11s
```

```bash
$ ./scripts/autodev_doctor.sh
...
=== summary: 11 passed, 0 failed, 2 warned ===
```

(Both warnings are environmental: tmux not installed; host `claude` CLI not on PATH — neither blocks the supervisor; Docker-fallback handles the CLI case.)

```bash
$ python3 -m pytest tests/test_v4_hardening.py tests/test_v4_e2e_replay.py -v --no-cov
... 30 tests passed in 0.06s
```

## Acceptance Criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Guardian does not false-pause under subscription mode | **PASS** | `test_db_record_run_zeros_cost_under_subscription` + `test_billable_load_budget_metrics_subscription` confirm cost is 0 at every layer (`runs` row, `metrics` aggregate, helper return). |
| Real paid-cost protection still works | **PASS** | `test_billable_to_billable_cost_api_mode_passes_through` + `test_billable_load_budget_metrics_api_mode` + `test_v4_scenario_16_clean_cycle_under_api_mode_preserves_cost`. |
| Impossible issue becomes terminal blocked | **PASS** | `test_preflight_impossible_spec_reverse_absent` + `test_v4_scenario_15_impossible_spec_terminalises_at_preflight` reproduce the exact #15 scenario; `pf.ok=False, pf.terminal_status="failed"`. |
| Preflight doesn't over-flag valid issues | **PASS** | 4 tests cover: symbol-present, no-forbidden-file, unrelated-issue, tests-forbidden-but-src-not. |
| Reviewer TDD policy no longer over-rejects valid PRs | **PASS** | `test_tdd_intent_accepts_edge_case_test_after_impl` reproduces V3's #14 failure pattern; `_check_tdd_invariant` returns `None`. Reviewer-prompt files updated to match. |
| Reviewer still rejects no-tests / tests-only-after-impl PRs | **PASS** | `test_tdd_intent_rejects_no_tests` + `test_tdd_intent_rejects_all_tests_after_impl`. |
| Pending-work detection honours STATE_DIR | **PASS** | `test_pending_work_honors_state_dir_env` + `test_pending_work_autodev_state_db_overrides_state_dir` + `test_resolve_state_db_path_falls_back_to_project_local`. |
| Pending-work returns False cleanly when DB absent | **PASS** | `test_pending_work_returns_false_when_db_missing`. |
| Regression suite passes | **PASS** | 97 passed, 1 skipped, 0 failed. |
| 3-issue e2e composite | **PASS (deterministic)** | `test_v4_composite_three_issues_no_intervention` exercises all three V4 fixes back-to-back in one test. Live e2e: deferred. |

## E2E Result (deterministic replay)

Replaying the exact V3 failure scenarios against the V4 codebase:

- **issues processed**: 3 (deterministic replay; real GitHub issues from V3 weren't re-created)
- **PRs that would open**: 1 (#16-equivalent) immediately; **#14-equivalent now passes TDD intent** and would proceed to Reviewer (previously stuck); **#15-equivalent terminalises at preflight with `failed` status**
- **Terminal states**: 2/3 deterministic (#15=failed/blocked_impossible_spec; #16=clean cycle would reach human_review); the third (#14) reaches Reviewer-pending — would either approve or reject on actual diff content, not on V3's TDD-ordering nit
- **Guardian false-pauses**: **0** — under subscription mode every `record_run` writes cost=0, so the DB sum Guardian queries can't trigger the "token spike" rule
- **Stuck items**: **0** — the V3 stuck-states (#15 reverse(), #14 edge-case-after-impl) are now either auto-terminalised or auto-passed by the deterministic gates
- **Manual intervention required**: **none** for the simulated scenarios

## Remaining Risks

1. **Live e2e against real GitHub not re-run.** The fixes are validated at unit-test scope. A short live cycle (creating one fresh issue, watching it land as a PR end-to-end) is still recommended before turning on autostart. Time / GitHub-API / Anthropic subscription limits made re-running the V3 full driver loop impractical in this session.
2. **Reviewer is still an LLM judgment call.** The deterministic `_check_tdd_invariant` gate now matches the relaxed policy, but the LLM Reviewer's role prompt is the second line of judgment. The prompt has been softened to match, but a real Opus session could still find unrelated reasons to reject; that's the design, and is desired behaviour.
3. **`orchestrator/main.py` bare imports** (`import circuit_breaker as cb` etc.) still assume cwd=orchestrator/. Tests work around this via `sys.path.insert(0, ".../orchestrator")` — fine for tests, but a future supervisor refactor that does proper package imports would simplify things.
4. **Preflight is intentionally narrow.** It only catches the specific "symbol-required + file-absent + file-forbidden" pattern from #15. Other impossibility patterns (unsatisfiable dependency, unreachable test environment, etc.) still go to Coder and rely on Coder's BLOCKED detection.
5. **State.blocked persistence on inner-engine exit-4** was already fixed in V3; not touched here.

## Recommendation

```
24/7 supervisor allowed: YES, conditional on one live-cycle sanity check first.
```

The unit-test-level acceptance bar is met. Before flipping `runtime.autostart_allowed: true` in `HUMAN_CONFIG.md`, run a single foreground cycle against a fresh test issue to confirm the deterministic replays match real-world behaviour:

```bash
gh issue create --repo CTlanston/auto-evo-playground --label agent:auto \
  --title "V4 live sanity: add multiply(a, b) utility" \
  --body "Add multiply(a, b) to src/utils.py with tests. Standard TDD."
AUTODEV_LIVE=1 ./scripts/autodev_once.sh
```

If that opens a PR within ~10–15 min without Guardian intervention, V4 has been confirmed in production and 24/7 is green-lit.

If V4 still hits a snag in the live cycle, file a V5 prompt and we go again. But unit-level the system is now significantly more robust than V3: 5 critical fails → 0 by deterministic measurement.

---

VERDICT: PASS at deterministic-acceptance level. 97/98 tests pass; 4 named V4 tracks closed with explicit regression coverage. Live e2e sanity-check recommended (not blocking) before 24/7 enable.
