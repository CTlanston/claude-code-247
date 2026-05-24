# Post-V3 Improvements — production-readiness gaps surfaced by the E2E test

> Triggered AFTER `reports/e2e-verdict-v3.md` is written. If V3 verdict is
> PASS or PARTIAL, work through these in order. Each item has a small TDD
> footprint. If V3 verdict was FAIL, **stop and surface the failure cause
> to the human first** — these improvements assume a working baseline.

## Context

V3 confirmed the AutoDev v3 architecture works end-to-end:
- All 5 critical defects from V1 are fixed (3 inner-engine + 2 supervisor)
- 3 GitHub issues processed through full pipeline (Planner → Coder → Reviewer)
- PRs opened, CI exercised, no phantom-cost regression

Running the test exposed 7 production-readiness gaps that the V3 grader
either tolerated or partially missed. Address them now so 24/7 isn't fragile.

---

## Improvement 1 — Phase 5 cleanup is too narrow (test hygiene)

**Symptom**: V3 Phase 5 only closed/deleted V1's specific issue numbers (#11, #12, #13). Issue #10 was a stuck V1 leftover in `coding` state that the rebuilt orchestrator picked up during the test, potentially spawning an unrelated PR that inflated grader C2's delta count.

**Fix**:
1. In `AUTODEV_E2E_TEST_V3.md` (and any future test plans), Phase 5 should drop **all rows in `tasks` table whose status is not `human_review` or `done`**, not just specific issue numbers. Document this as a "leave only terminal-state work" cleanup pattern.
2. Tighten `scripts/e2e_grade.sh` C2 to count PRs **per-test-issue**, not as a global delta. Pseudocode:
   ```bash
   # Count PRs whose head matches one of the 3 test issues vs others
   for n in "$A" "$B" "$C"; do
     [[ $(gh pr list --head "shadow/issue-$n" ... | jq length) -eq 1 ]] && test_prs=$((test_prs+1))
   done
   other_new_prs=$((delta - test_prs))
   # PASS if test_prs == 3 AND other_new_prs == 0
   # PART if test_prs == 3 AND other_new_prs > 0 (cleanup gap, not a loop)
   # FAIL otherwise (true regression)
   ```
3. Add a regression test that simulates a leftover task and verifies the cleanup logic.

**Acceptance**: cleanup script generalized, grader distinguishes "PR-as-issue loop regression" from "stale leftover processed during test", one regression test added.

---

## Improvement 2 — Bare-repo bootstrap (security path A reachable)

**Symptom**: `git_proxy.mirror_to_github` falls back to pushing from the per-issue worktree because the local bare repo at `WORKSPACE_ROOT/.bare/` was never created. Functionally correct (Cowork's fallback patch handles it) but loses the security property that GitHub tokens stay in the orchestrator process — when pushing from the worktree, the runner container's git config could in principle see the credential URL.

**Fix**:
1. Add a `scripts/bootstrap_bare_repo.sh` that:
   - Creates `WORKSPACE_ROOT/.bare/` as a bare git repo
   - Adds the GitHub remote with token-injected HTTPS URL
   - Pulls all branches from origin
   - Idempotent (re-runnable safely)
2. Wire `autodev_doctor.sh` to detect missing bare repo and instruct the user to run the bootstrap.
3. Wire `git_proxy.ensure_remote()` to call the bootstrap automatically if `_local_remote().exists()` is False AND `LOCAL_MODE != 1` (no-op in local mode).
4. Add a unit test for the bootstrap (mocking the `git` subprocess calls).

**Acceptance**: bare repo exists after bootstrap; mirror_to_github exercises Path A (bare-remote mirror) by default; worktree fallback is now a true edge-case rescue.

---

## Improvement 3 — Runner container wall-clock timeout (24/7 critical)

**Symptom**: If a runner container hangs (LLM rate-limit, infinite tool-loop, Claude CLI freeze), the orchestrator's `runner.run_role()` blocks indefinitely. In `autodev_supervisor.sh` long-run this would silently wedge the entire system.

**Fix**:
1. In `orchestrator/runner.py`, when spawning a runner container via the Docker SDK, set `timeout=N` on `container.wait()` (currently unbounded).
2. Define per-role timeout via HUMAN_CONFIG:
   ```yaml
   runner_timeout_seconds:
     planner: 300
     coder: 1200
     reviewer: 600
     guardian: 300
   ```
   Default values if HUMAN_CONFIG missing.
3. On timeout: SIGKILL the runner container, return `exit_code=124` (UNIX timeout convention), record `summary="timeout"` in `runs` table.
4. In `main.py:_process_one`, treat exit 124 as a failure that increments retry counter (same as any other Coder non-zero exit).
5. Add a regression test: mock a runner that sleeps past the timeout, assert the function returns within timeout + 5s and records exit 124.

**Acceptance**: a hanging runner cannot wedge the supervisor; timeout is configurable; an existing run of the test suite still passes.

---

## Improvement 4 — `scripts/autodev_status.sh` quick view

**Symptom**: To answer "what is the orchestrator doing right now?" requires four manual queries (SQLite tasks, SQLite runs, gh pr list, docker logs). Hard to read mid-task.

**Fix**: Add `scripts/autodev_status.sh` that prints:
```
=== AutoDev v3 status @ <ts> ===
Mode: <cheap|balanced|premium>  Live: <yes|no>  Paused: <reason or no>

Tasks in flight:
  #14  coding         shadow/issue-14   rounds=2  age=04:12
  #15  reviewing      shadow/issue-15   rounds=1  age=02:30
  #16  human_review   shadow/issue-16   rounds=0  PR=#17 OPEN

Active runner containers:
  claude-coder-14-abc123     Up 1m
  claude-reviewer-15-def456  Up 30s

Recent runs (last 5):
  09:42  reviewer    #16   exit=0   cost=$0.18  in=4500 out=820
  09:39  coder       #16   exit=0   cost=$0.42  in=3200 out=1100
  ...

Recent supervisor log (last 5 lines):
  ...
```

No new dependencies. Pure shell + sqlite3 + gh CLI + docker.

**Acceptance**: running `./scripts/autodev_status.sh` once produces a compact dashboard usable from the command line without manual SQL.

---

## Improvement 5 — Configurable Guardian interval

**Symptom**: `GUARDIAN_INTERVAL_MINUTES` defaults to 240 (4 hours). For tests this is too long; for production it might be too short. Hard-coded in `main.py`.

**Fix**:
1. Read interval from HUMAN_CONFIG (`runtime.guardian_interval_minutes`), fall back to env var, fall back to 240.
2. Add to HUMAN_CONFIG.template.md with explanation.
3. Validate it's a positive integer; reject 0 or negative.
4. Add a unit test for the precedence (config > env > default).

**Acceptance**: changing the value in HUMAN_CONFIG takes effect on next orchestrator restart without code change.

---

## Improvement 6 — Inner-engine summary in `reports/state.json`

**Symptom**: `reports/state.json` tracks supervisor state but not inner-engine progress. To know "how many issues are in flight?" you have to query SQLite separately.

**Fix**:
1. At the end of each `Supervisor.run_once()`, populate `state.inner_summary`:
   ```json
   "inner_summary": {
     "tasks_in_flight": 3,
     "tasks_by_status": {"coding": 1, "reviewing": 1, "human_review": 1},
     "open_prs_count": 2,
     "last_run_finished_at": 1715424100
   }
   ```
2. The data comes from the same SQLite queries `autodev_status.sh` would make.
3. Update existing supervisor regression tests to verify this field exists and is non-empty after a cycle.

**Acceptance**: `cat reports/state.json | jq .inner_summary` shows a useful single-pane view.

---

## Improvement 7 — Graceful supervisor shutdown (signal handling)

**Symptom**: `Ctrl-C` on `autodev_supervisor.sh` interrupts mid-cycle, possibly leaving an orphan runner container. The 24/7 launchd install would also benefit from clean shutdown on `launchctl unload`.

**Fix**:
1. In `autoevo/autodev/supervisor.py`, install SIGINT/SIGTERM handlers that:
   - Refuse new cycles
   - Wait for the current `run_once()` to finish (with a 5-minute cap)
   - Reap any active runner containers (best-effort `docker stop --time 10`)
   - Write a "graceful shutdown" marker to `reports/session-log.md`
   - Exit cleanly
2. Add a regression test using a fake signal injection mid-cycle.

**Acceptance**: Ctrl-C during a long cycle no longer leaves orphans; launchd unload is clean.

---

## Execution plan

Work through 1 → 7 in order. Each improvement is its own commit:
- `fix(test-hygiene): generalize Phase 5 cleanup + tighten grader C2`
- `feat(bootstrap): bare-repo bootstrap for mirror_to_github Path A`
- `feat(runner): wall-clock timeout per role with HUMAN_CONFIG override`
- `feat(scripts): autodev_status.sh quick dashboard`
- `feat(config): guardian interval from HUMAN_CONFIG`
- `feat(state): include inner-engine summary in reports/state.json`
- `feat(supervisor): signal handlers for graceful shutdown`

After all 7 land + tests green + doctor green: **install long-running supervisor (Phase 18)**:
```bash
./scripts/install_launchd_autodev.sh --install
```

Verify with `launchctl list | grep autodev` and tail `reports/session-log.md`.

## Hard constraints (same as always)

- No push to `main`, local commits only.
- No PR merges.
- No paid Anthropic API.
- No `.env` / secret changes.
- One commit per improvement; clean test suite at every commit.
- If you hit a blocker, append to `reports/human-hold.md` and STOP.

## Final report

After all improvements land (or you hit an unrecoverable blocker), write
`reports/post-v3-summary.md`:
- Which improvements completed / which deferred
- Test count and coverage delta
- Any new HOLDs to surface
- Recommended next step (e.g., "ready for launchd install" or "needs human decision on X")
