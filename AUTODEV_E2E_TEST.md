# End-to-End Test — "Does this thing actually deserve 24/7 trust?" (AutoDev v3 path)

> **Make-or-break.** AutoDev v3 supervisor drives the inner engine through
> **three back-to-back live cycles**, processing three distinct GitHub issues.
> If any cycle re-processes a dead task, crashes the engine, or fails to reach
> human_review on its issue, the verdict is FAIL.
>
> Pass = the system is worth keeping on 24/7. Fail = report root cause and stop.

## Architecture decision (already made — don't relitigate)

- **AutoDev v3 supervisor** drives. Compose stack stays STOPPED for the whole test.
- Driver = repeated `AUTODEV_LIVE=1 ./scripts/autodev_once.sh` calls. Each call
  invokes `orchestrator/main_oneshot.py` on the host. `main_oneshot.py` calls
  the existing `engine.ingest_issues()` + `engine._process_one()` — so the role
  pipeline (Planner / Coder / Reviewer) and PR creation are unchanged.
- HUMAN_CONFIG.md keeps `autostart_allowed: false`. Foreground loop only.

## Architectural debt acknowledged, held for tomorrow

- PR #10 was merged into the test repo (`auto-evo-playground`), not the
  harness repo (`claude-code-247`). `record_run` root-cause fix is NOT in
  the running orchestrator. The system still relies on the
  `_is_subscription` tactical patch + `pull_request is None` filter.
  **Do NOT try to fix this during the test.** Held for tomorrow.

## The 3-cycle acceptance bar

A real 24/7 system must:

1. **Cycle 1** — successfully process a small feature task to `human_review`.
2. **Cycle 2** — successfully process a different task (test enhancement) without re-touching cycle 1's dead task.
3. **Cycle 3** — successfully process a third task, or correctly skip if invalid, again without touching cycles 1/2.

**Invariant across all three:** no single issue gets reprocessed (no duplicate
tasks rows, no duplicate shadow branches, no infinite loops). The PR-filter
fix is the line of defense; this test exercises it under multi-task load.

## Pre-flight (mandatory; abort on any RED)

Run from `/Users/lanston/Desktop/Claude Code/claude-code-247`:

```bash
cat HUMAN_CONFIG.md | grep -E 'live_allowed|cost\.mode' | head -3
grep -n 'pull_request is None' orchestrator/github_client.py
grep -n '_is_subscription' orchestrator/main.py
docker info >/dev/null 2>&1 && echo "docker daemon ok"
docker image inspect claude-code-247/runner:latest --format '{{.Id}}'
command -v gh >/dev/null && gh auth status
python3 -m pytest tests/ -q --no-cov 2>&1 | tail -3
./scripts/autodev_doctor.sh
```

Every line above must succeed. If anything is RED, append a HOLD entry to
`reports/human-hold.md` and STOP.

## Phase A — Stop the compose stack (one driver only)

```bash
cd "/Users/lanston/Desktop/Claude Code/claude-code-247"
docker compose stop orchestrator
docker ps --filter name=claude-code-247-orchestrator --format '{{.Names}}\t{{.Status}}'
docker image inspect claude-code-247/runner:latest --format '{{.Id}}'
```

If the runner image is missing: `docker compose build runner` before proceeding.

## Phase B — Snapshot baseline

```bash
sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM runs;"  >  /tmp/e2e-runs-before.txt
sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM tasks;" >  /tmp/e2e-tasks-before.txt
gh issue list --repo CTlanston/auto-evo-playground --state open --json number --jq 'length' > /tmp/e2e-issues-before.txt
gh pr list   --repo CTlanston/auto-evo-playground --state open --label agent:auto --json number --jq 'length' > /tmp/e2e-prs-before.txt
date -u +%s > /tmp/e2e-start-time.txt
echo "baseline: runs=$(cat /tmp/e2e-runs-before.txt) tasks=$(cat /tmp/e2e-tasks-before.txt) open-issues=$(cat /tmp/e2e-issues-before.txt) open-prs=$(cat /tmp/e2e-prs-before.txt)"
```

## Phase C — Clear PAUSED (safety-gated)

```bash
if [[ -f state/PAUSED.human ]]; then
  echo "STOP — state/PAUSED.human exists. Hard human freeze. Append to reports/human-hold.md and exit." >&2
  exit 1
fi
[[ -f state/PAUSED ]] && rm state/PAUSED && echo "PAUSED cleared at $(date -u)"
```

## Phase D — Create THREE test issues (one per cycle)

```bash
mkdir -p /tmp/e2e-bodies
```

### D.1 — Issue A: feature add (`chunks`)

```bash
cat > /tmp/e2e-bodies/A.md <<'EOF'
## Task
Add a `chunks(items, n)` utility to `src/utils.py` with tests in `tests/test_chunks.py`.

## Spec
- Signature: `def chunks(items: list, n: int) -> list[list]:`
- `chunks([1,2,3,4,5], 2)` → `[[1,2],[3,4],[5]]`
- `chunks([], 3)` → `[]`
- `chunks([1,2], 5)` → `[[1,2]]`
- `chunks([1,2,3], 0)` → raises `ValueError`
- `chunks([1,2,3], -1)` → raises `ValueError`

## Acceptance
1. Tests in `tests/test_chunks.py` cover all 5 cases above plus one extra.
2. `src/utils.py` implementation ≤ 8 lines.
3. TDD ordering: `test:` commit BEFORE `feat:` commit on the shadow branch.
4. `pytest tests/test_chunks.py` green on the shadow branch (CI verifies).
5. `ruff check src/utils.py tests/test_chunks.py` clean.

## Out of scope
- Modifying any existing function in `src/utils.py`.
- Generators / itertools — return a plain list.
EOF

gh issue create \
  --repo CTlanston/auto-evo-playground --label agent:auto \
  --title "Cycle1: Add chunks(items, n) utility" \
  --body-file /tmp/e2e-bodies/A.md \
  > /tmp/e2e-issue-A.txt
ISSUE_A=$(grep -oE '/issues/[0-9]+' /tmp/e2e-issue-A.txt | grep -oE '[0-9]+')
echo "$ISSUE_A" > /tmp/e2e-issue-A.num
echo "Issue A: #$ISSUE_A"
```

### D.2 — Issue B: test enhancement for existing `reverse()`

```bash
cat > /tmp/e2e-bodies/B.md <<'EOF'
## Task
The `reverse(s)` function in `src/utils.py` (added in earlier work) currently has minimal test coverage. Add comprehensive edge-case tests in `tests/test_reverse_edges.py` without modifying `reverse()` itself.

## Spec
Tests must cover:
- Unicode string with combining marks (e.g. `"café"` → `"éfac"`)
- Emoji-only string (e.g. `"🚀🌟"` → `"🌟🚀"`)
- Mixed-script (e.g. `"abc中文"` → `"文中cba"`)
- Single character
- Whitespace-only string

## Acceptance
1. `tests/test_reverse_edges.py` exists with at least one test per bullet above.
2. **Do NOT modify `src/utils.py` or existing tests.**
3. TDD ordering: `test:` commits only on this shadow branch (no `feat:` because we're not adding production code).
4. `pytest tests/test_reverse_edges.py` green on the shadow branch.
5. `ruff check tests/test_reverse_edges.py` clean.

## Out of scope
- Changing `reverse()` itself.
- Modifying any other existing test files.
EOF

gh issue create \
  --repo CTlanston/auto-evo-playground --label agent:auto \
  --title "Cycle2: Add edge-case tests for reverse()" \
  --body-file /tmp/e2e-bodies/B.md \
  > /tmp/e2e-issue-B.txt
ISSUE_B=$(grep -oE '/issues/[0-9]+' /tmp/e2e-issue-B.txt | grep -oE '[0-9]+')
echo "$ISSUE_B" > /tmp/e2e-issue-B.num
echo "Issue B: #$ISSUE_B"
```

### D.3 — Issue C: feature add (`safe_int`)

```bash
cat > /tmp/e2e-bodies/C.md <<'EOF'
## Task
Add a `safe_int(s, default=0)` utility to `src/utils.py` with tests in `tests/test_safe_int.py`.

## Spec
- Signature: `def safe_int(s, default: int = 0) -> int:`
- `safe_int("42")` → `42`
- `safe_int("  3 ")` → `3`  (strips whitespace)
- `safe_int("abc")` → `0`
- `safe_int("abc", default=-1)` → `-1`
- `safe_int(None, default=7)` → `7`
- `safe_int(3.7)` → `3`  (truncates float)

## Acceptance
1. Tests in `tests/test_safe_int.py` cover all 6 cases above plus one extra.
2. `src/utils.py` implementation ≤ 10 lines.
3. TDD ordering: `test:` commit BEFORE `feat:` commit.
4. `pytest tests/test_safe_int.py` green on the shadow branch.
5. `ruff check src/utils.py tests/test_safe_int.py` clean.

## Out of scope
- Modifying any existing function in `src/utils.py`.
- Locale-aware integer parsing.
EOF

gh issue create \
  --repo CTlanston/auto-evo-playground --label agent:auto \
  --title "Cycle3: Add safe_int(s, default) utility" \
  --body-file /tmp/e2e-bodies/C.md \
  > /tmp/e2e-issue-C.txt
ISSUE_C=$(grep -oE '/issues/[0-9]+' /tmp/e2e-issue-C.txt | grep -oE '[0-9]+')
echo "$ISSUE_C" > /tmp/e2e-issue-C.num
echo "Issue C: #$ISSUE_C"

echo "All three issues created: A=#$ISSUE_A B=#$ISSUE_B C=#$ISSUE_C"
echo "$ISSUE_A $ISSUE_B $ISSUE_C" > /tmp/e2e-issues.list
```

### D.4 — Backlog trigger (single TASK to wake the supervisor)

```bash
TASK_ID="TASK-E2E-$(date +%s)"
echo "$TASK_ID" > /tmp/e2e-task-id.txt
cat >> tasks/backlog.md <<EOF

## $TASK_ID (P1)
3-cycle E2E validation. Drives the inner engine through issues #$(cat /tmp/e2e-issue-A.num), #$(cat /tmp/e2e-issue-B.num), #$(cat /tmp/e2e-issue-C.num).
- priority: P1
- created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- expected_outcome: each of the 3 issues reaches human_review with a clean PR
EOF
echo "Backlog updated with $TASK_ID"
```

## Phase E — Drive the 3 cycles

Loop `autodev_once.sh` until **all three** GitHub issues reach `human_review`,
or 90 minutes elapse, or a critical regression appears.

```bash
ISSUES=( $(cat /tmp/e2e-issues.list) )
deadline=$(( $(date -u +%s) + 5400 ))   # 90 min hard cap
iteration=0
max_iterations=45                        # ~90 min ceiling at 120s avg

# Track the order tasks reach terminal state — used by the grader for
# the "no dead-task reprocessing" invariant.
> /tmp/e2e-terminal-order.txt

while [[ $(date -u +%s) -lt $deadline && $iteration -lt $max_iterations ]]; do
  iteration=$((iteration + 1))
  echo "════════ iter $iteration / $max_iterations at $(date -u +%H:%M:%S) ════════"

  AUTODEV_LIVE=1 ./scripts/autodev_once.sh 2>&1 | tail -15
  cycle_exit=$?
  echo "(autodev_once exit: $cycle_exit)"

  # Status of all three issues
  done_count=0
  for n in "${ISSUES[@]}"; do
    s=$(sqlite3 state/orchestrator.db "SELECT status FROM tasks WHERE issue_id=$n;" 2>/dev/null || echo "")
    pr=$(gh pr list --repo CTlanston/auto-evo-playground \
         --head "shadow/issue-$n" --state all \
         --json state --jq '.[0].state // "none"')
    echo "  #$n status=${s:-<not yet>} pr_state=$pr"

    if [[ "$s" == "human_review" || "$s" == "failed" ]]; then
      if ! grep -q "^$n$" /tmp/e2e-terminal-order.txt 2>/dev/null; then
        echo "$n" >> /tmp/e2e-terminal-order.txt
      fi
      done_count=$((done_count + 1))
    fi
  done

  echo "→ terminal: $done_count / 3 ($(tr '\n' ' ' < /tmp/e2e-terminal-order.txt))"

  # Early-exit on full success
  if [[ "$done_count" -eq 3 ]]; then
    echo "→ ALL THREE reached terminal — moving to grade."
    break
  fi

  # Guard against re-pause
  if [[ -f state/PAUSED ]]; then
    echo "⚠ PAUSED re-appeared at iter $iteration. Audit:"
    sqlite3 state/orchestrator.db \
      "SELECT datetime(at,'unixepoch','localtime'), substr(detail,1,300)
       FROM audit WHERE actor='guardian'
       ORDER BY id DESC LIMIT 1;"
    break
  fi

  sleep 60
done

date -u +%s > /tmp/e2e-end-time.txt
elapsed=$(( $(cat /tmp/e2e-end-time.txt) - $(cat /tmp/e2e-start-time.txt) ))
echo "Total elapsed: ${elapsed}s ($((elapsed/60))m $((elapsed%60))s) over $iteration iter(s)"
echo "Terminal order: $(tr '\n' ' ' < /tmp/e2e-terminal-order.txt)"
```

## Phase F — Run the grader

```bash
bash scripts/e2e_grade.sh \
  "$(cat /tmp/e2e-issue-A.num)" \
  "$(cat /tmp/e2e-issue-B.num)" \
  "$(cat /tmp/e2e-issue-C.num)"
```

The grader exits 0 (PASS), 1 (FAIL), or 2 (PARTIAL).

## Phase G — Write the verdict report

Write `reports/e2e-verdict.md` containing:

- The verdict line and grader output table
- The three issue numbers + their PR URLs + their final task statuses
- Terminal-reach order (from `/tmp/e2e-terminal-order.txt`)
- Total elapsed wall time + iteration count + average per-issue wall time
- Total runs added during test, total cost reported by inner DB (will be 0 under subscription)
- Phantom rows added (must be 0)
- Final tasks-table row count for each test issue (must be exactly 1 each — no dead-task reprocessing)
- `reports/state.json` excerpt at end
- If FAIL: minimum-information root cause, specific criterion

DO NOT push, merge, or close any PR. Human reviews and decides.

## Hard constraints

- No push to `main`.
- No auto-merge.
- No paid API (`cost.mode: cheap`).
- Don't touch `.env`, secrets, keychains.
- Don't try to fix the PR-#10-in-wrong-repo issue during the test. **Held.**
- If blocked on a critical issue (e.g., gh auth gone, Docker dead), append to `reports/human-hold.md` and STOP.

## Verdict criteria (mirrored in `scripts/e2e_grade.sh`)

| # | Criterion | Pass means | Severity |
|---|-----------|-----------|----------|
| 1  | 3 PRs opened (one per issue) | `gh pr list --head shadow/issue-N` returns exactly 1 for each of the 3 issues | 🔴 critical |
| 2  | No PR-as-issue infinite loop | open agent:auto PR count delta ≤ **3** (one per issue, no extras) | 🔴 critical |
| 3  | TDD ordering on issues A, C (feature adds) | each shadow has `test:` commit before `feat:` commit | 🟡 |
| 4  | Spec coverage in PR A (chunks) | tests reference all 5 spec cases | 🟡 |
| 5  | Spec coverage in PR C (safe_int) | tests reference all 6 spec cases | 🟡 |
| 6  | CI green on all 3 PRs | `gh pr checks <PR>` shows no failures on any of the three | 🔴 critical |
| 7  | Issue B respects "no source mod" | PR B touches only `tests/`, **not** `src/utils.py` | 🟡 |
| 8  | No phantom-cost rows during test | rows added with `input_tokens=0 AND cost_usd>0` since start = **0** | 🔴 critical |
| 9  | Inner engine no crash | `reports/state.json.health_status != "error"`; no blocker_reason mentioning "exit 4" | 🔴 critical |
| 10 | 90-minute time budget | elapsed ≤ 5400s | 🟡 |
| 11 | **No dead-task reprocessing** | each test issue has exactly **one** row in `tasks` table at end; each has exactly **one** shadow branch | 🔴 critical |
| 12 | All three issues reached terminal state | each in `tasks` table at `human_review` or `failed` | 🔴 critical |

Any 🔴 fails = **FAIL**. PARTIAL = some 🟡 amber misses but no 🔴.

## Final output

Exactly one of:

- `VERDICT: PASS — 3 cycles green, no dead-task reprocessing. PR URLs: <A> <B> <C>.`
- `VERDICT: PARTIAL — <N>/12 green. Misses: <list>. Human review recommended.`
- `VERDICT: FAIL — <criterion>: <one-line reason>.`

Then stop. Human reads `reports/e2e-verdict.md` to decide on 24/7 subscription.
