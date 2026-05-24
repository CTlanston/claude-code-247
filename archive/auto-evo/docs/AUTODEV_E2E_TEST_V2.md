# End-to-End Test V2 — Compose-stack path, after the 3 internal fixes

> V1 test (`AUTODEV_E2E_TEST.md`) drove via AutoDev v3 supervisor and **failed**.
> V2 simplifies: drop the outer supervisor layer entirely, drive via the
> existing compose stack (which has worked 24/7 for 3 days). Same 3-issue
> 12-criterion grading bar. The 3 inner-engine defects exposed by V1 are
> already patched on disk.

## Pre-applied fixes (already on disk, not yet in the running image)

| Defect (V1 root cause) | File | Status |
|------------------------|------|--------|
| `latest_workflow_run_status` IndexError on empty PaginatedList | `orchestrator/github_client.py` | ✓ patched |
| `mirror_to_github` silent-loss on missing bare repo | `orchestrator/git_proxy.py` | ✓ patched + worktree fallback |
| `record_run` double-write + zero-token phantom cost | `orchestrator/db.py` | ✓ idempotent + zero-cost guard |

Phase A's rebuild bakes these into the orchestrator image.

## Architecture decision

- **Compose stack drives.** AutoDev v3 outer-loop supervisor is shelved
  (defects 2 + 3 not worth fixing for v2 — code stays on disk for future use).
- The orchestrator container's 15s poll loop handles ingest → role pipeline → PR.
- No `main_oneshot.py` invocations from host; no foreground supervisor loop.
- Test driver = create issues, then `tail -f` and grade after task transitions.

## Pre-flight (mandatory; abort on any RED)

Run from `/Users/lanston/projects/claude-code-247`:

```bash
# Verify the 3 fixes are on disk
grep -n 'latest_workflow_run_status' orchestrator/github_client.py     # 2+ lines from try/except block
grep -nE 'fallback|worktree push' orchestrator/git_proxy.py            # the fallback comment
grep -nE 'zero-token zero-cost|idempotent INSERT' orchestrator/db.py   # 2 fix comments

# Standard infra
docker info >/dev/null 2>&1 && echo "docker daemon ok"
docker image inspect claude-code-247/runner:latest --format '{{.Id}}'
command -v gh && gh auth status
```

Every line must succeed. If anything RED, append to `reports/human-hold.md` and stop.

## Phase A — Rebuild image with the 3 fixes

```bash
cd "/Users/lanston/projects/claude-code-247"
docker compose stop orchestrator
docker compose build orchestrator
docker compose up -d orchestrator
sleep 5

# Verify each fix landed in the new image
docker exec claude-code-247-orchestrator-1 grep -A2 'latest_workflow_run_status(' /app/github_client.py | head -5
docker exec claude-code-247-orchestrator-1 grep 'worktree push' /app/git_proxy.py
docker exec claude-code-247-orchestrator-1 grep 'idempotent INSERT' /app/db.py
```

All three greps must find their respective marker. If any is empty: STOP and report.

## Phase B — Clean slate: close stuck V1 issues + reset stuck task rows

V1 left issues #11, #12, #13 in inner-DB `reviewing` state with broken shadow
branches. To start V2 clean, close those issues on GitHub AND drop their
inner-DB rows.

```bash
for n in 11 12 13; do
  gh issue close $n --repo CTlanston/auto-evo-playground \
    --comment "Superseded by V2 E2E test after inner-engine fixes." \
    --reason "not planned"
done

sqlite3 state/orchestrator.db "DELETE FROM tasks WHERE issue_id IN (11, 12, 13);"
sqlite3 state/orchestrator.db "SELECT issue_id, status FROM tasks;"   # show what's left
```

## Phase C — Snapshot baseline

```bash
sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM runs;"  >  /tmp/e2e-runs-before.txt
sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM tasks;" >  /tmp/e2e-tasks-before.txt
gh pr list --repo CTlanston/auto-evo-playground --state open --label agent:auto --json number --jq 'length' > /tmp/e2e-prs-before.txt
date -u +%s > /tmp/e2e-start-time.txt
```

## Phase D — Safety: clear PAUSED if present

```bash
if [[ -f state/PAUSED.human ]]; then
  echo "STOP — state/PAUSED.human exists. Append to reports/human-hold.md and exit." >&2
  exit 1
fi
[[ -f state/PAUSED ]] && rm state/PAUSED && echo "PAUSED cleared at $(date -u)"
```

## Phase E — Create 3 fresh test issues

Same 3-issue spec as V1 (chunks / reverse-edges / safe_int). Use the
template files already saved at `/tmp/e2e-bodies/{A,B,C}.md` from the V1 run,
OR re-write them here. Body content is identical:

```bash
# If /tmp/e2e-bodies/ files survived the prior session, use them.
# Otherwise: cat them out again from AUTODEV_E2E_TEST.md §D.1-D.3.
test -f /tmp/e2e-bodies/A.md && echo "reusing existing /tmp/e2e-bodies"

for label in A B C; do
  if [[ ! -f /tmp/e2e-bodies/$label.md ]]; then
    echo "ERROR: /tmp/e2e-bodies/$label.md missing. Re-create from AUTODEV_E2E_TEST.md §D" >&2
    exit 1
  fi
done

ISSUE_A=$(gh issue create --repo CTlanston/auto-evo-playground --label agent:auto \
  --title "V2-Cycle1: Add chunks(items, n) utility" --body-file /tmp/e2e-bodies/A.md \
  | grep -oE '/issues/[0-9]+' | grep -oE '[0-9]+')
ISSUE_B=$(gh issue create --repo CTlanston/auto-evo-playground --label agent:auto \
  --title "V2-Cycle2: Add edge-case tests for reverse()" --body-file /tmp/e2e-bodies/B.md \
  | grep -oE '/issues/[0-9]+' | grep -oE '[0-9]+')
ISSUE_C=$(gh issue create --repo CTlanston/auto-evo-playground --label agent:auto \
  --title "V2-Cycle3: Add safe_int(s, default) utility" --body-file /tmp/e2e-bodies/C.md \
  | grep -oE '/issues/[0-9]+' | grep -oE '[0-9]+')

echo "$ISSUE_A" > /tmp/e2e-issue-A.num
echo "$ISSUE_B" > /tmp/e2e-issue-B.num
echo "$ISSUE_C" > /tmp/e2e-issue-C.num
echo "Created: A=#$ISSUE_A B=#$ISSUE_B C=#$ISSUE_C"
```

## Phase F — Wait + monitor (compose handles dispatch; you observe)

```bash
ISSUES=( "$(cat /tmp/e2e-issue-A.num)" "$(cat /tmp/e2e-issue-B.num)" "$(cat /tmp/e2e-issue-C.num)" )
deadline=$(( $(date -u +%s) + 5400 ))   # 90 min ceiling
poll_sec=90

while [[ $(date -u +%s) -lt $deadline ]]; do
  echo "════ $(date -u +%H:%M:%S) ════"

  # Status of all three from inner DB
  done_count=0
  for n in "${ISSUES[@]}"; do
    s=$(sqlite3 state/orchestrator.db "SELECT status FROM tasks WHERE issue_id=$n;" 2>/dev/null || echo "")
    pr=$(gh pr list --repo CTlanston/auto-evo-playground \
         --head "shadow/issue-$n" --state all \
         --json state --jq '.[0].state // "none"')
    echo "  #$n  status=${s:-<not yet>}  pr_state=$pr"
    [[ "$s" == "human_review" || "$s" == "failed" ]] && done_count=$((done_count + 1))
  done

  if [[ "$done_count" -eq 3 ]]; then
    echo "→ all three terminal, proceeding to grade"
    break
  fi

  # Re-pause guard
  if [[ -f state/PAUSED ]]; then
    echo "⚠ PAUSED re-appeared. Last guardian audit:"
    sqlite3 state/orchestrator.db \
      "SELECT datetime(at,'unixepoch','localtime'), substr(detail,1,300) FROM audit
       WHERE actor='guardian' ORDER BY id DESC LIMIT 1;"
    break
  fi

  # Last 8 lines of orchestrator activity
  docker logs --since 95s claude-code-247-orchestrator-1 2>&1 | grep -vE 'dispatch paused' | tail -8

  sleep $poll_sec
done

date -u +%s > /tmp/e2e-end-time.txt
echo "elapsed: $(( $(cat /tmp/e2e-end-time.txt) - $(cat /tmp/e2e-start-time.txt) ))s"
```

## Phase G — Grade

```bash
bash scripts/e2e_grade.sh \
  "$(cat /tmp/e2e-issue-A.num)" \
  "$(cat /tmp/e2e-issue-B.num)" \
  "$(cat /tmp/e2e-issue-C.num)"
```

Exit 0 = PASS, 1 = FAIL, 2 = PARTIAL.

## Phase H — Write verdict

Write `reports/e2e-verdict-v2.md` with:
- Verdict line
- Grader output table
- 3 issue numbers + PR URLs + final task status
- Total elapsed wall time
- Total runs added during the test
- Phantom rows added (target: 0)
- Open agent:auto PR delta (target: ≤3)
- For each PR: commit count, file list
- `docker logs --since <test-duration> | tail -40`
- If FAIL: minimum-info root cause

## Hard constraints

- No push to `main`.
- No auto-merge of PRs.
- No paid API (`cost.mode: cheap` enforced by HUMAN_CONFIG).
- Don't touch `.env`, secrets.
- Don't modify orchestrator code during the test. The 3 fixes were applied
  BEFORE this test; nothing should change during it.
- If blocked, append to `reports/human-hold.md` and STOP.

## Verdict criteria (mirrored in `scripts/e2e_grade.sh`)

| # | Criterion | Pass | Severity |
|---|-----------|------|----------|
| 1  | 3 PRs opened | one per issue | 🔴 critical |
| 2  | No PR-as-issue loop | open agent:auto PR delta ≤ 3 | 🔴 critical |
| 3  | TDD ordering on A, C | `test:` commit before `feat:` | 🟡 |
| 4  | PR A covers 5 spec cases | matches ≥5 | 🟡 |
| 5  | PR C covers 6 spec cases | matches ≥6 | 🟡 |
| 6  | CI green on all 3 | no failures | 🔴 critical |
| 7  | PR B no src/ mod | tests/ only | 🟡 |
| 8  | No phantom-cost rows | delta = 0 | 🔴 critical |
| 9  | Orchestrator container survived | Up, no recent traceback | 🔴 critical |
| 10 | 90-minute budget | elapsed ≤ 5400s | 🟡 |
| 11 | No dead-task reprocessing | 1 task row + 1 shadow per issue | 🔴 critical |
| 12 | All 3 in terminal state | human_review or failed | 🔴 critical |

Any 🔴 fails = **FAIL**.

## Final output

Exactly one of:
- `VERDICT: PASS — 3 cycles green via compose stack. PR URLs: <A> <B> <C>.`
- `VERDICT: PARTIAL — <N>/12 green. Misses: <list>.`
- `VERDICT: FAIL — <criterion>: <one-line reason>.`

Then stop.
