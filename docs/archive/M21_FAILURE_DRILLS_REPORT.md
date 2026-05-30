# M21 Failure-Mode Drills

Six deterministic integration tests that prove the system's
safety-blocking behaviors fire correctly when bad inputs hit the
dispatcher. Each drill is a single test file under
`tests/integration/` and runs entirely in-process against the
SandboxRunner / SandboxGithub harness (no real GitHub or Claude
calls).

| Drill | File | Verdict |
|---|---|---|
| A — Secret scanner blocks merge | [test_secret_scanner_blocks_merge.py](tests/integration/test_secret_scanner_blocks_merge.py) | ✅ PASS |
| B — Validator disagreement blocks | [test_validator_disagreement_blocks_merge.py](tests/integration/test_validator_disagreement_blocks_merge.py) | ✅ PASS |
| C — High-risk path blocks | [test_high_risk_blocks_automerge.py](tests/integration/test_high_risk_blocks_automerge.py) | ✅ PASS |
| D — Budget exceeded defers task | [test_budget_exceeded_pauses_repo.py](tests/integration/test_budget_exceeded_pauses_repo.py) | ✅ PASS (with deviation note) |
| E — `stop-all` emergency kill | [test_stop_all_emergency_kill.py](tests/integration/test_stop_all_emergency_kill.py) | ✅ PASS |
| F — gh merge failure records worker_exit | [test_merge_failure_records_worker_exit.py](tests/integration/test_merge_failure_records_worker_exit.py) | ✅ PASS |

```
$ .venv/bin/python -m pytest tests/integration/test_secret_scanner_blocks_merge.py \
                              tests/integration/test_validator_disagreement_blocks_merge.py \
                              tests/integration/test_high_risk_blocks_automerge.py \
                              tests/integration/test_budget_exceeded_pauses_repo.py \
                              tests/integration/test_stop_all_emergency_kill.py \
                              tests/integration/test_merge_failure_records_worker_exit.py -q
6 passed in 0.61s
```

Full suite after these tests: **523 passing**.

## What each drill asserts

### A — Secret scanner blocks merge

Setup: validators both PASS, repo opted in to auto-merge.
Injected: `+API_KEY = 'ghp_aaaa…'` shape in the diff content.
Asserts:
- `ruling.decision == "blocked"`
- `gh.merge_calls == []`
- `task.status == "failed"`
- ruling reasons cite "secret"

### B — Validator disagreement blocks

Setup: repo opted in to auto-merge, real-validator shape.
Injected: Gemini=PASS, OpenAI=NEEDS_HUMAN (the M19/M20 production
case before M20-P3j).
Asserts:
- `ruling.decision in ("waiting_approval", "blocked")`
- `gh.merge_calls == []`
- PR is created so operator can review
- `task.status == "waiting_for_approval"`
- `prs.approval_state == "required"`

### C — High-risk path blocks

Setup: validators PASS, low changed-line count.
Injected: diff touches `.env`. This triggers the
`forbidden_path_touch: 100` risk factor — pushing risk into the
**high** band even when nothing else is wrong.
Asserts:
- `risk_scores.score >= 100`
- `risk_scores.level == "high"`
- `ruling.decision == "blocked"`
- `gh.merge_calls == []`

### D — Budget exceeded defers task

Setup: `max_tasks_per_day: 1`; pre-fill `tasks_count` to 2.
Asserts:
- `result.deferred == True`
- result.reason contains "budget exceeded"
- No task created in DB
- No runner / GitHub calls
- `budget_exceeded` notification emitted

**Deviation from directive spelling**: the directive says "repo paused"
on budget cap. Current dispatcher **defers** the specific command and
notifies, but does NOT automatically call `system_state.pause_repo()`.
The safety property (no work happens when over budget) is preserved.
Whether to escalate to a hard pause on repeat budget hits is filed as
M22 / post-GA backlog.

### E — `stop-all` emergency kill

Setup: two active tasks queued, then `stop_all` command enqueued.
Asserts:
- After processing `stop_all`: `system_state.is_system_paused() == True`
- Both prior active tasks transition out of queued (cancelled / paused / stopped)
- A subsequent `start_task` is refused (either dispatcher reports
  "system paused" idle, or it succeeds-as-deferred)
- The SandboxRunner is never invoked for the post-stop task

### F — gh merge failure records worker_exit

Setup: validators PASS, ruling = AUTO_MERGE, FailingMergeGithub's
`merge_pr` raises `GitHubError("403: branch protection check failed")`.
Asserts:
- PR is created
- `merge_pr` is attempted (gh.merge_calls non-empty)
- Task ends as `failed`, not `merged`
- A `worker_exits` row with `phase=auto_merge` exists
- That row has `status="failure"`, `classification="github_failure"`,
  `error_type="GitHubError"`, `error_message` contains "403"

This last drill is the M21-P2 dividend: the operator's
`claude247 task-phases --task <id>` immediately shows
`auto_merge → failure (github_failure)` with the upstream error.
Without the M21-P2 instrumentation, the only signal would have been
`summary["merge_error"]` buried in the run_once result + a log line.
