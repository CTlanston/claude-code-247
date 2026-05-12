# AutoDev v3 — End-to-End Test V3 (full architecture, all defects fixed)

> Read this entire file before doing anything. V1 of this test (`AUTODEV_E2E_TEST.md`)
> failed with 5 critical defects. **V3 fixes all five**: three are already on disk
> (applied by Cowork in the prior session); two are supervisor bugs **you (Claude Code)
> must fix yourself in this session before the test runs**. Then re-run the same
> 3-cycle 12-criterion test with the AutoDev v3 supervisor as the driver.
>
> Pass = the AutoDev v3 outer-loop architecture is production-ready, system goes 24/7.
> Fail = report the smallest reproducible failure mode and stop.

---

## Background: what V1 exposed

V1 ran for 75 minutes, processed 3 issues partway, and graded `FAIL` on 5 critical criteria. Root cause diagnosis (from `reports/e2e-verdict.md`):

| # | Defect | Layer | Status entering V3 |
|---|--------|-------|---------------------|
| 1 | `latest_workflow_run_status` raises IndexError on empty PaginatedList — single crash halts the entire inner-engine loop for ALL issues | Inner engine | ✅ **Patched on disk** in `orchestrator/github_client.py` (try/except wrap + totalCount guard) |
| 2 | Supervisor `SELECT_NEW` short-circuits with "no work in backlog" when all bullets are `[.]` (in_progress) — never invokes inner engine even though GitHub has pending work | Outer (AutoDev v3) | ❌ **Must fix in this session** |
| 3 | Supervisor never clears `state.blocked` after a successful cycle — stale `exit 4` flag persists across cycles | Outer (AutoDev v3) | ❌ **Must fix in this session** |
| 4 | `record_run` double-write + zero-token-non-zero-cost — pollutes `runs` table, Guardian reads phantom totals as spike | Inner engine | ✅ **Patched on disk** in `orchestrator/db.py` (idempotent INSERT + zero-cost guard) |
| 5 | `mirror_to_github` silently returns when bare repo missing — Coder pushes vanish, shadow branches end up empty | Inner engine | ✅ **Patched on disk** in `orchestrator/git_proxy.py` (worktree push fallback + raise on failure) |

You'll verify #1/#4/#5 made it into the rebuilt image, fix #2/#3 yourself with TDD, then run the full V3 test.

---

## Architecture decision (already made — don't relitigate)

- **AutoDev v3 supervisor drives.** The compose-stack orchestrator container is stopped for the test duration. Two drivers on the same SQLite + GitHub state caused V1's HOLD-5.
- Driver = repeated `AUTODEV_LIVE=1 ./scripts/autodev_once.sh` calls (one tick per call) — same as V1.
- Each tick: supervisor reads HUMAN_CONFIG/state/backlog → picks a task → calls `orchestrator/main_oneshot.py` as a host subprocess → main_oneshot calls `engine.ingest_issues()` + `engine._process_one()`.
- HUMAN_CONFIG keeps `autostart_allowed: false`. Foreground loop only.

## Architectural debt acknowledged, **held for tomorrow** (do not fix in V3)

- PR #10 was merged into the test repo `auto-evo-playground`, not the harness repo `claude-code-247`. The `record_run` fix landed in the wrong place. Cowork's `orchestrator/db.py` patch on disk **already provides the equivalent logic** in the right place, so V3 doesn't need PR #10's diff. This architectural mismatch (orchestrator can't easily PR against its own harness) stays as a separate decision for a different session.

---

## Phase 0 — Pre-flight & decision memo

Run from `/Users/lanston/Desktop/Claude Code/claude-code-247`. Every check must pass; if anything is RED, append a HOLD entry to `reports/human-hold.md` and stop.

```bash
# Confirm the 3 inner-engine patches are on disk (applied by Cowork last session)
grep -A2 'IndexError'    orchestrator/github_client.py | head -10
grep -nE 'worktree push' orchestrator/git_proxy.py
grep -nE 'zero-token zero-cost|idempotent INSERT' orchestrator/db.py

# Standard infra
cat HUMAN_CONFIG.md | grep -E 'live_allowed|cost\.mode' | head -3
docker info >/dev/null && echo "docker daemon ok"
docker image inspect claude-code-247/runner:latest --format '{{.Id}}'
command -v gh && gh auth status
python3 -m pytest tests/ -q --no-cov 2>&1 | tail -3
./scripts/autodev_doctor.sh
```

After verification, write a short memo to `reports/v3-plan.md` listing:
- Which on-disk patches you verified
- Which supervisor defects you'll fix and your planned approach (one paragraph each)
- The 3 test issues you'll create (chunks / reverse-edges / safe_int — same as V1)

Don't proceed past Phase 0 until this memo exists. Show it to the human only if anything in the plan surprises you.

---

## Phase 1 — Fix Supervisor Defect #2 (`SELECT_NEW` short-circuit)

### The bug

V1 wake-up report observed:
> "iters 2–8 spawned no containers. The supervisor's `SELECT_NEW` returns early when `backlog.next_unblocked()` is None (all `[ ]` tasks already marked `[.]` from prior cycles), and never calls the inner engine even though it has GitHub work pending."

The supervisor treats the local `tasks/backlog.md` as the ONLY source of "what to do next". The inner engine has its own queue (GitHub issues + SQLite `tasks` table) that the supervisor ignores when backlog is empty. The inner engine therefore never gets a chance to drain its own pending work.

### The fix (TDD; write the test first)

1. **Write a regression test in `tests/` (or wherever supervisor tests live):**
   - Set up a scenario where `tasks/backlog.md` has zero `[ ]` (todo) items, but `reports/state.json` indicates `live_allowed: true` AND the inner engine has at least one row in SQLite `tasks` table with status in `("queued", "coding", "ci_running", "reviewing")`.
   - Assert that `Supervisor.run_once()` STILL calls `InnerEngine.run_task()` (or equivalent) with a synthetic task instead of returning early.
   - The test should fail against current code, pass after your fix.

2. **Implement the fix in `autoevo/autodev/supervisor.py`:**
   - In `SELECT_NEW` (or whatever state your phase-machine uses), when `backlog.next_unblocked()` returns None, check whether the inner engine has pending work before short-circuiting.
   - "Pending work" = at least one row in `runs/tasks` SQLite table with status in `("queued", "coding", "ci_running", "reviewing")`.
   - If pending, build a synthetic task (`TASK-INNER-<timestamp>` or similar) and proceed through the same `run_task` path — the inner engine will pick whichever GitHub issue is queued.
   - If not pending, the original early return is still correct ("genuinely nothing to do").

3. **Run all tests:**
   ```bash
   python3 -m pytest tests/ -q --no-cov 2>&1 | tail -5
   ```
   The new test must pass; existing tests must still pass.

---

## Phase 2 — Fix Supervisor Defect #3 (stale `state.blocked`)

### The bug

V1 wake-up report observed:
> "Supervisor never clears `state.blocked` on successful cycle — stale `exit 4` flag persists forever"

Once `state.blocked = True` with `blocker_reason = "inner engine exit 4"`, the supervisor never clears it on a subsequent successful cycle. This makes the grader (and any operator) treat the system as permanently broken even after recovery.

### The fix (TDD; write the test first)

1. **Write a regression test:**
   - Initialize `reports/state.json` with `blocked=True`, `blocker_reason="inner engine exit 4"`, `health_status="error"`.
   - Mock the inner engine to return exit 0 (clean success) for one cycle.
   - Run `Supervisor.run_once()`.
   - Assert: after the cycle, `state.blocked` is False, `state.blocker_reason` is None, `state.health_status` is in `("ok", "warn")` but not "error".
   - The test should fail against current code, pass after your fix.

2. **Implement the fix in `autoevo/autodev/supervisor.py`:**
   - After the inner-engine subprocess returns, if exit code is 0 (clean tick) OR 2 (paused/rate-limited but graceful), reset `state.blocked = False` and `state.blocker_reason = None`.
   - For exit 3 (terminal Anthropic error → PAUSED set) and exit 4 (uncaught exception), keep current behavior (record blocker, possibly hold).
   - For exit 1 (init failure / known recoverable), reset blocker on a fresh cycle if the prior blocker is older than 1 hour (avoids permanent stuck state from yesterday's transient issue).

3. **Run all tests:**
   ```bash
   python3 -m pytest tests/ -q --no-cov 2>&1 | tail -5
   ```
   New test passes, existing tests still pass.

---

## Phase 3 — Sanity (everything still green)

```bash
python3 -m pytest tests/ -q --no-cov 2>&1 | tail -3
./scripts/autodev_doctor.sh
```

Both must succeed with 0 failures. Doctor warns are OK (tmux/host-claude HOLDs from earlier).

Commit the supervisor fixes (do NOT push):

```bash
git add autoevo/autodev/supervisor.py tests/
git commit -m "fix(autodev-v3): two supervisor defects surfaced by V1 E2E

- SELECT_NEW now invokes inner engine when local backlog is empty but
  inner SQLite has pending tasks (issue/coding/reviewing/ci_running).
  V1 symptom: iters 2-8 spawned no containers despite GitHub work pending.
- state.blocked is cleared on exit 0 or exit 2 from the inner engine
  subprocess. V1 symptom: stale 'exit 4' blocker persisted across cycles
  forever, even after successful recovery.
- Added two regression tests covering both behaviours.
"
```

---

## Phase 4 — Rebuild orchestrator image (bake the 3 inner-engine patches)

The supervisor fixes run on the host and don't need a rebuild. The inner-engine patches (Cowork's work) need the image rebuilt to take effect.

```bash
docker compose stop orchestrator   # if still running
docker compose build orchestrator
# Do NOT bring it back up — the test will drive via AutoDev v3 supervisor, not compose.
docker exec claude-code-247-runner:latest true 2>/dev/null || \
  docker image inspect claude-code-247/runner:latest --format '{{.Id}}'

# Verify all 3 inner patches landed in the new orchestrator image
# (image will be used by main_oneshot subprocesses spawned from host? actually no — main_oneshot
# runs on host directly. But the runner image still needs the patches if you ever swap modes.)
# Just sanity-check the host disk versions are correct:
grep -A2 'IndexError' orchestrator/github_client.py | head -10
grep 'worktree push' orchestrator/git_proxy.py
grep 'idempotent INSERT' orchestrator/db.py
```

If `docker compose up -d orchestrator` was accidentally started: stop it. AutoDev v3 drives, compose stays down.

---

## Phase 5 — Clean up V1 stuck state

V1 left issues #11, #12, #13 in `reviewing` state with broken shadow branches. Close them on GitHub and drop their inner-DB rows so V3 starts clean.

```bash
for n in 11 12 13; do
  gh issue close $n --repo CTlanston/auto-evo-playground \
    --comment "Superseded by V3 E2E run after inner-engine + supervisor fixes." \
    --reason "not planned" 2>/dev/null || echo "issue #$n: already closed or missing"
done

sqlite3 state/orchestrator.db "DELETE FROM tasks WHERE issue_id IN (11, 12, 13);"
sqlite3 state/orchestrator.db "SELECT issue_id, status FROM tasks;"   # show what's left
```

Optionally also delete the stuck shadow branches (cosmetic):
```bash
for n in 11 12 13; do
  gh api -X DELETE "repos/CTlanston/auto-evo-playground/git/refs/heads/shadow/issue-$n" 2>/dev/null || true
done
```

---

## Phase 6 — Snapshot baseline + safety + 3 fresh issues

### Baseline

```bash
sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM runs;"  >  /tmp/e2e-runs-before.txt
sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM tasks;" >  /tmp/e2e-tasks-before.txt
gh pr list --repo CTlanston/auto-evo-playground --state open --label agent:auto --json number --jq 'length' > /tmp/e2e-prs-before.txt
date -u +%s > /tmp/e2e-start-time.txt
```

### Safety: clear PAUSED if a Cowork session set it (and no `.human` marker)

```bash
if [[ -f state/PAUSED.human ]]; then
  echo "STOP — state/PAUSED.human exists. Append to reports/human-hold.md and exit." >&2
  exit 1
fi
[[ -f state/PAUSED ]] && rm state/PAUSED && echo "PAUSED cleared at $(date -u)"
```

### Issues

If `/tmp/e2e-bodies/{A,B,C}.md` survived from V1, reuse them. Otherwise re-create them per the spec in `AUTODEV_E2E_TEST.md` §D.1-D.3. Three GitHub issues with `agent:auto` label:

- **Issue A**: Add `chunks(items, n)` to `src/utils.py` + tests covering 5 specified cases.
- **Issue B**: Add edge-case tests for the existing `reverse()` function in `tests/test_reverse_edges.py` (must NOT modify `src/utils.py`).
- **Issue C**: Add `safe_int(s, default=0)` to `src/utils.py` + tests covering 6 specified cases.

Save numbers to `/tmp/e2e-issue-{A,B,C}.num`. Print "Created: A=#$A B=#$B C=#$C".

### Backlog trigger (single TASK to wake the supervisor)

```bash
TASK_ID="TASK-V3-$(date +%s)"
cat >> tasks/backlog.md <<EOF

## $TASK_ID (P1)
V3 E2E test trigger. Drives the inner engine through 3 issues.
- priority: P1
- created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- expected_outcome: each of the 3 V3 issues reaches human_review
EOF
```

---

## Phase 7 — Drive 3 cycles via AutoDev v3 supervisor

90-minute hard cap. Same pattern as V1 Phase E but with bugfixes in place. Defect #2 fix means even when the local backlog drains, the supervisor will keep calling the inner engine.

```bash
ISSUE_A=$(cat /tmp/e2e-issue-A.num)
ISSUE_B=$(cat /tmp/e2e-issue-B.num)
ISSUE_C=$(cat /tmp/e2e-issue-C.num)
ISSUES=( "$ISSUE_A" "$ISSUE_B" "$ISSUE_C" )
deadline=$(( $(date -u +%s) + 5400 ))
iteration=0
max_iterations=45
> /tmp/e2e-terminal-order.txt

while [[ $(date -u +%s) -lt $deadline && $iteration -lt $max_iterations ]]; do
  iteration=$((iteration + 1))
  echo "════════ iter $iteration / $max_iterations at $(date -u +%H:%M:%S) ════════"

  AUTODEV_LIVE=1 ./scripts/autodev_once.sh 2>&1 | tail -15
  echo "(autodev_once exit: $?)"

  done_count=0
  for n in "${ISSUES[@]}"; do
    s=$(sqlite3 state/orchestrator.db "SELECT status FROM tasks WHERE issue_id=$n;" 2>/dev/null || echo "")
    pr=$(gh pr list --repo CTlanston/auto-evo-playground --head "shadow/issue-$n" --state all --json state --jq '.[0].state // "none"')
    echo "  #$n  status=${s:-<not yet>}  pr=$pr"
    if [[ "$s" == "human_review" || "$s" == "failed" ]]; then
      if ! grep -q "^$n$" /tmp/e2e-terminal-order.txt 2>/dev/null; then
        echo "$n" >> /tmp/e2e-terminal-order.txt
      fi
      done_count=$((done_count + 1))
    fi
  done
  echo "→ terminal: $done_count / 3 ($(tr '\n' ' ' < /tmp/e2e-terminal-order.txt))"

  if [[ "$done_count" -eq 3 ]]; then
    echo "→ ALL THREE reached terminal — grading time."
    break
  fi

  # Re-pause guard
  if [[ -f state/PAUSED ]]; then
    echo "⚠ PAUSED re-appeared at iter $iteration:"
    sqlite3 state/orchestrator.db "SELECT datetime(at,'unixepoch','localtime'), substr(detail,1,300) FROM audit WHERE actor='guardian' ORDER BY id DESC LIMIT 1;"
    break
  fi

  sleep 60
done

date -u +%s > /tmp/e2e-end-time.txt
echo "elapsed: $(( $(cat /tmp/e2e-end-time.txt) - $(cat /tmp/e2e-start-time.txt) ))s over $iteration iter(s)"
echo "terminal order: $(tr '\n' ' ' < /tmp/e2e-terminal-order.txt)"
```

---

## Phase 8 — Grade + write verdict

```bash
bash scripts/e2e_grade.sh \
  "$(cat /tmp/e2e-issue-A.num)" \
  "$(cat /tmp/e2e-issue-B.num)" \
  "$(cat /tmp/e2e-issue-C.num)"
```

Then write `reports/e2e-verdict-v3.md` with:
- Verdict line and full grader table
- Three issue numbers + PR URLs + final task status
- Terminal-reach order (from `/tmp/e2e-terminal-order.txt`)
- Elapsed wall time + iteration count
- Total runs added during test (`SELECT COUNT(*) FROM runs WHERE started_at > $start`)
- Phantom rows added (target: 0)
- Open agent:auto PR delta (target: ≤3)
- Final `reports/state.json` excerpt
- A short "what V1 → V3 changed" summary (which patches landed, which tests were added)
- If FAIL: minimum-information root cause, specific criterion

DO NOT push, merge, or close any PR. Human reviews and decides.

---

## Hard constraints (same as V1; reproduced here to be unambiguous)

- No `git push` to any remote. Local commits only.
- No PR auto-merge.
- No paid Anthropic API (`cost.mode: cheap` enforced; OAuth token only).
- No `.env`, secrets, keychains, or SSH-key edits.
- Only fix the **two named supervisor defects** in this session. Do NOT improvise additional refactors. Do NOT touch the playground repo to fix PR #10's architectural mismatch — that's tomorrow.
- If you hit a blocker (gh auth dead, Docker dead, image build fails, etc.), append to `reports/human-hold.md` with a clear cause and STOP. Do not paper over.

---

## Verdict criteria (mirrored in `scripts/e2e_grade.sh`)

| # | Criterion | Pass means | Severity |
|---|-----------|-----------|----------|
| 1  | 3 PRs opened | one per issue | 🔴 critical |
| 2  | No PR-as-issue loop | open agent:auto PR delta ≤ 3 | 🔴 critical |
| 3  | TDD ordering on A, C | `test:` commit before `feat:` commit | 🟡 |
| 4  | PR A covers 5 spec cases | matches ≥5 | 🟡 |
| 5  | PR C covers 6 spec cases | matches ≥6 | 🟡 |
| 6  | CI green on all 3 PRs | no failures | 🔴 critical |
| 7  | PR B touches only `tests/` | no `src/` modification | 🟡 |
| 8  | No phantom-cost rows | delta = 0 | 🔴 critical |
| 9  | Inner engine no crash | `state.json.health_status != error` AND no `exit 4` blocker | 🔴 critical |
| 10 | 90-minute budget | elapsed ≤ 5400s | 🟡 |
| 11 | No dead-task reprocessing | each issue has exactly 1 task row + 1 shadow branch | 🔴 critical |
| 12 | All 3 in terminal state | `human_review` or `failed` | 🔴 critical |

Any 🔴 fails → **FAIL** verdict → human will not go 24/7.

---

## Final output

Exactly one of:

- `VERDICT: PASS — 3 cycles green via AutoDev v3 supervisor. All 5 defects fixed. PR URLs: <A> <B> <C>.`
- `VERDICT: PARTIAL — <N>/12 green. Misses: <list>. Human review recommended.`
- `VERDICT: FAIL — <criterion>: <one-line reason>.`

Then stop. Human reads `reports/e2e-verdict-v3.md` to decide on 24/7 subscription commitment.
