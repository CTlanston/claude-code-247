#!/usr/bin/env bash
# e2e_grade.sh — grader for the 3-cycle AutoDev v3 E2E test.
# Usage: bash scripts/e2e_grade.sh <issueA> <issueB> <issueC>
#  - issueA: "chunks" feature add
#  - issueB: "reverse() edge-case tests" (no src/ change)
#  - issueC: "safe_int" feature add
# Reads /tmp/e2e-*-time.txt and /tmp/e2e-*-before.txt from Phase B.
# Exits 0 = PASS, 1 = FAIL (any critical red), 2 = PARTIAL (only amber misses).

set -u
A="${1:?usage: e2e_grade.sh <issueA> <issueB> <issueC>}"
B="${2:?usage: e2e_grade.sh <issueA> <issueB> <issueC>}"
C="${3:?usage: e2e_grade.sh <issueA> <issueB> <issueC>}"
REPO="CTlanston/auto-evo-playground"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

green=$'\e[32m'; red=$'\e[31m'; yel=$'\e[33m'; rst=$'\e[0m'
pass=0; fail=0; partial=0; critical_fail=0

result() {
  local status="$1" id="$2" desc="$3" detail="${4:-}"
  case "$status" in
    PASS)    printf "%-6s ${green}%s${rst}  %-50s %s\n" "[$id]" "PASS" "$desc" "$detail"; pass=$((pass+1)) ;;
    FAIL)    printf "%-6s ${red}%s${rst}  %-50s %s\n" "[$id]" "FAIL" "$desc" "$detail"; fail=$((fail+1)) ;;
    PART)    printf "%-6s ${yel}%s${rst}  %-50s %s\n" "[$id]" "PART" "$desc" "$detail"; partial=$((partial+1)) ;;
  esac
}
mark_critical() { critical_fail=$((critical_fail+1)); }

echo "════════════════════════════════════════════════════════════════"
echo "  AutoDev v3 E2E Grader — issues #$A #$B #$C on ${REPO}"
echo "════════════════════════════════════════════════════════════════"

# --- baselines ---
runs_before=$(cat /tmp/e2e-runs-before.txt 2>/dev/null || echo 0)
prs_before=$(cat /tmp/e2e-prs-before.txt 2>/dev/null || echo 0)
start_time=$(cat /tmp/e2e-start-time.txt 2>/dev/null || date -u +%s)
end_time=$(cat /tmp/e2e-end-time.txt 2>/dev/null || date -u +%s)
elapsed=$(( end_time - start_time ))

# --- helper: get PR number for a given shadow branch ---
get_pr_for_branch() {
  local n="$1"
  gh pr list --repo "$REPO" --head "shadow/issue-${n}" --state all \
    --json number --jq '.[0].number // empty' 2>/dev/null
}

# Cache PR numbers
PR_A=$(get_pr_for_branch "$A")
PR_B=$(get_pr_for_branch "$B")
PR_C=$(get_pr_for_branch "$C")

# ════════════════════════════════════════════════════════════════
# C1: 3 PRs opened (critical)
# ════════════════════════════════════════════════════════════════
n_prs=0
[[ -n "$PR_A" ]] && n_prs=$((n_prs+1))
[[ -n "$PR_B" ]] && n_prs=$((n_prs+1))
[[ -n "$PR_C" ]] && n_prs=$((n_prs+1))

if (( n_prs == 3 )); then
  result PASS C1 "3 PRs opened (one per issue)" "A=#$PR_A B=#$PR_B C=#$PR_C"
else
  miss=""
  [[ -z "$PR_A" ]] && miss="${miss}A "
  [[ -z "$PR_B" ]] && miss="${miss}B "
  [[ -z "$PR_C" ]] && miss="${miss}C "
  result FAIL C1 "3 PRs opened (one per issue)" "got $n_prs/3; missing: $miss"
  mark_critical
fi

# ════════════════════════════════════════════════════════════════
# C2: No PR-as-issue infinite loop (critical)
# ════════════════════════════════════════════════════════════════
prs_after=$(gh pr list --repo "$REPO" --state open --label "agent:auto" --json number --jq 'length')
delta=$((prs_after - prs_before))
if (( delta <= 3 )); then
  result PASS C2 "No PR-as-issue infinite loop" "open agent:auto PR delta=${delta}"
else
  result FAIL C2 "No PR-as-issue infinite loop" "delta=${delta} (expected ≤3) — duplicates regenerated"
  mark_critical
fi

# ════════════════════════════════════════════════════════════════
# C3: TDD ordering on A and C (feature adds)
# ════════════════════════════════════════════════════════════════
tdd_ok=0; tdd_check=0
for pair in "A:$PR_A" "C:$PR_C"; do
  label=${pair%:*}; pr=${pair#*:}
  [[ -z "$pr" ]] && continue
  tdd_check=$((tdd_check+1))
  commits=$(gh pr view "$pr" --repo "$REPO" --json commits --jq '.commits[].messageHeadline' 2>/dev/null)
  test_line=$(echo "$commits" | grep -nE '^test:' | head -1 | cut -d: -f1)
  feat_line=$(echo "$commits" | grep -nE '^feat:' | head -1 | cut -d: -f1)
  if [[ -n "$test_line" && -n "$feat_line" && $test_line -lt $feat_line ]]; then
    tdd_ok=$((tdd_ok+1))
  fi
done
if (( tdd_check == 0 )); then
  result FAIL C3 "TDD ordering on A, C" "no feature PRs to inspect"
elif (( tdd_ok == tdd_check )); then
  result PASS C3 "TDD ordering on A, C" "$tdd_ok/$tdd_check feature PRs follow test→feat"
else
  result FAIL C3 "TDD ordering on A, C" "$tdd_ok/$tdd_check feature PRs follow test→feat"
fi

# ════════════════════════════════════════════════════════════════
# C4: Spec coverage in PR A (chunks) — 5 cases
# ════════════════════════════════════════════════════════════════
if [[ -n "$PR_A" ]]; then
  content=$(gh api "repos/${REPO}/contents/tests/test_chunks.py?ref=shadow/issue-${A}" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  cov=0
  echo "$content" | grep -qE '\[1, ?2, ?3, ?4, ?5\]'      && cov=$((cov+1))
  echo "$content" | grep -qE 'chunks\(\[\]'               && cov=$((cov+1))
  echo "$content" | grep -qE 'chunks\(\[1, ?2\], ?5'      && cov=$((cov+1))
  echo "$content" | grep -qE 'chunks\([^)]+, ?0\)'        && cov=$((cov+1))
  echo "$content" | grep -qE 'chunks\([^)]+, ?-1\)'       && cov=$((cov+1))
  if (( cov >= 5 )); then
    result PASS C4 "PR A (chunks) covers 5 spec cases" "matches=$cov/5"
  elif (( cov >= 4 )); then
    result PART C4 "PR A (chunks) covers 5 spec cases" "matches=$cov/5"
  else
    result FAIL C4 "PR A (chunks) covers 5 spec cases" "matches=$cov/5"
  fi
else
  result FAIL C4 "PR A (chunks) covers 5 spec cases" "no PR A"
fi

# ════════════════════════════════════════════════════════════════
# C5: Spec coverage in PR C (safe_int) — 6 cases
# ════════════════════════════════════════════════════════════════
if [[ -n "$PR_C" ]]; then
  content=$(gh api "repos/${REPO}/contents/tests/test_safe_int.py?ref=shadow/issue-${C}" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  cov=0
  echo "$content" | grep -qE 'safe_int\(\s*"42"'           && cov=$((cov+1))
  echo "$content" | grep -qE 'safe_int\([^)]*" *3 *"'      && cov=$((cov+1))
  echo "$content" | grep -qE 'safe_int\(\s*"abc"\s*\)'     && cov=$((cov+1))
  echo "$content" | grep -qE 'safe_int\([^)]*"abc"[^)]*-1' && cov=$((cov+1))
  echo "$content" | grep -qE 'safe_int\([^)]*None'         && cov=$((cov+1))
  echo "$content" | grep -qE 'safe_int\([^)]*3\.7'         && cov=$((cov+1))
  if (( cov >= 6 )); then
    result PASS C5 "PR C (safe_int) covers 6 spec cases" "matches=$cov/6"
  elif (( cov >= 5 )); then
    result PART C5 "PR C (safe_int) covers 6 spec cases" "matches=$cov/6"
  else
    result FAIL C5 "PR C (safe_int) covers 6 spec cases" "matches=$cov/6"
  fi
else
  result FAIL C5 "PR C (safe_int) covers 6 spec cases" "no PR C"
fi

# ════════════════════════════════════════════════════════════════
# C6: CI green on all 3 PRs (critical)
# ════════════════════════════════════════════════════════════════
ci_ok=0; ci_check=0; ci_pending=0; ci_detail=""
for pair in "A:$PR_A" "B:$PR_B" "C:$PR_C"; do
  label=${pair%:*}; pr=${pair#*:}
  [[ -z "$pr" ]] && { ci_detail="${ci_detail}${label}=no_pr "; continue; }
  ci_check=$((ci_check+1))
  checks=$(gh pr checks "$pr" --repo "$REPO" 2>&1 || true)
  if echo "$checks" | grep -qiE 'fail'; then
    ci_detail="${ci_detail}${label}=fail "
  elif echo "$checks" | grep -qiE 'pending|in_progress|queued'; then
    ci_pending=$((ci_pending+1))
    ci_detail="${ci_detail}${label}=pending "
  elif echo "$checks" | grep -qiE 'pass'; then
    ci_ok=$((ci_ok+1))
    ci_detail="${ci_detail}${label}=pass "
  else
    ci_detail="${ci_detail}${label}=unknown "
  fi
done
if (( ci_check == 3 && ci_ok == 3 )); then
  result PASS C6 "CI green on all 3 PRs" "$ci_detail"
elif (( ci_check == 3 && ci_ok + ci_pending == 3 && ci_pending > 0 )); then
  result PART C6 "CI green on all 3 PRs" "$ci_detail (some still pending)"
else
  result FAIL C6 "CI green on all 3 PRs" "$ci_detail"
  mark_critical
fi

# ════════════════════════════════════════════════════════════════
# C7: Issue B respects "no source mod" (only touches tests/)
# ════════════════════════════════════════════════════════════════
if [[ -n "$PR_B" ]]; then
  files=$(gh pr view "$PR_B" --repo "$REPO" --json files --jq '.files[].path' 2>/dev/null)
  src_touched=$(echo "$files" | grep -E '^src/' || true)
  if [[ -z "$src_touched" ]]; then
    result PASS C7 "PR B touches tests/ only (no src/)" "files: $(echo "$files" | tr '\n' ' ')"
  else
    result FAIL C7 "PR B touches tests/ only (no src/)" "modified: $src_touched"
  fi
else
  result FAIL C7 "PR B touches tests/ only (no src/)" "no PR B"
fi

# ════════════════════════════════════════════════════════════════
# C8: No phantom-cost rows during the test (critical)
# ════════════════════════════════════════════════════════════════
phantom=$(sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM runs WHERE started_at > $start_time AND (input_tokens IS NULL OR input_tokens = 0) AND (output_tokens IS NULL OR output_tokens = 0) AND cost_usd > 0;" 2>/dev/null || echo 0)
if [[ "$phantom" == "0" ]]; then
  result PASS C8 "No phantom-cost rows during test" "phantom_new=0"
else
  result FAIL C8 "No phantom-cost rows during test" "phantom_new=${phantom} — record_run bug recurring"
  mark_critical
fi

# ════════════════════════════════════════════════════════════════
# C9: Inner engine no crash — auto-detect driver mode
#   - compose path:   orchestrator container Up + no recent tracebacks
#   - autodev v3 path: reports/state.json health != error + no exit-4
# Pass if either signal is healthy (depending on which driver is in use).
# ════════════════════════════════════════════════════════════════
status=$(docker ps --filter name=claude-code-247-orchestrator --format '{{.Status}}' 2>/dev/null)
if echo "$status" | grep -q '^Up'; then
  # compose path
  crashes=$(docker logs --since 90m claude-code-247-orchestrator-1 2>&1 | grep -cE 'Traceback|uncaught exception|exit code 4\b' || true)
  if (( crashes > 0 )); then
    result PART C9 "Inner engine no crash (compose)" "$status — $crashes traceback in last 90m"
  else
    result PASS C9 "Inner engine no crash (compose)" "$status"
  fi
else
  # autodev v3 path
  health=$(python3 -c "import json,pathlib; p=pathlib.Path('reports/state.json'); print(json.loads(p.read_text()).get('health_status','missing') if p.exists() else 'missing')" 2>/dev/null || echo "missing")
  blocker=$(python3 -c "import json,pathlib; p=pathlib.Path('reports/state.json'); print(json.loads(p.read_text()).get('blocker_reason') or '' if p.exists() else '')" 2>/dev/null || echo "")
  if [[ "$health" == "error" ]]; then
    result FAIL C9 "Inner engine no crash (autodev)" "state.health=error blocker='$blocker'"
    mark_critical
  elif echo "$blocker" | grep -qi 'exit 4'; then
    result FAIL C9 "Inner engine no crash (autodev)" "blocker mentions exit 4 (uncaught exception)"
    mark_critical
  elif [[ "$health" == "missing" ]]; then
    result PART C9 "Inner engine no crash (autodev)" "reports/state.json missing"
  else
    result PASS C9 "Inner engine no crash (autodev)" "state.health=${health}"
  fi
fi

# ════════════════════════════════════════════════════════════════
# C10: 90-minute time budget
# ════════════════════════════════════════════════════════════════
if (( elapsed <= 5400 )); then
  result PASS C10 "Completed within 90-minute budget" "elapsed=${elapsed}s ($((elapsed/60))m)"
else
  result FAIL C10 "Completed within 90-minute budget" "elapsed=${elapsed}s exceeded 5400s"
fi

# ════════════════════════════════════════════════════════════════
# C11: No dead-task reprocessing (critical)
# Each test issue must have exactly 1 row in tasks table AND exactly 1 shadow branch.
# ════════════════════════════════════════════════════════════════
dup_rows=0; multi_branch=0; dead_detail=""
for n in "$A" "$B" "$C"; do
  rows=$(sqlite3 state/orchestrator.db "SELECT COUNT(*) FROM tasks WHERE issue_id=$n;" 2>/dev/null || echo 0)
  branches=$(gh api "repos/${REPO}/branches" --jq ".[] | select(.name == \"shadow/issue-${n}\") | .name" 2>/dev/null | wc -l | tr -d ' ')
  if (( rows > 1 )); then
    dup_rows=$((dup_rows+1))
    dead_detail="${dead_detail}#${n}_rows=${rows} "
  fi
  if (( branches > 1 )); then
    multi_branch=$((multi_branch+1))
    dead_detail="${dead_detail}#${n}_branches=${branches} "
  fi
done
if (( dup_rows == 0 && multi_branch == 0 )); then
  result PASS C11 "No dead-task reprocessing" "each issue has 1 task row + 1 shadow branch"
else
  result FAIL C11 "No dead-task reprocessing" "$dead_detail"
  mark_critical
fi

# ════════════════════════════════════════════════════════════════
# C12: All three issues reached terminal state (critical)
# ════════════════════════════════════════════════════════════════
terminal_count=0; term_detail=""
for n in "$A" "$B" "$C"; do
  s=$(sqlite3 state/orchestrator.db "SELECT status FROM tasks WHERE issue_id=$n;" 2>/dev/null || echo "")
  case "$s" in
    human_review|failed) terminal_count=$((terminal_count+1)); term_detail="${term_detail}#${n}=${s} " ;;
    *) term_detail="${term_detail}#${n}=${s:-<missing>} " ;;
  esac
done
if (( terminal_count == 3 )); then
  result PASS C12 "All 3 issues reached terminal state" "$term_detail"
else
  result FAIL C12 "All 3 issues reached terminal state" "$terminal_count/3 — $term_detail"
  mark_critical
fi

# ════════════════════════════════════════════════════════════════
# verdict
# ════════════════════════════════════════════════════════════════
echo "════════════════════════════════════════════════════════════════"
echo "  pass=$pass  partial=$partial  fail=$fail  critical_fail=$critical_fail"
if (( critical_fail > 0 )); then
  echo "  ${red}VERDICT: FAIL${rst}  (${critical_fail} critical criteria failed) — not worth 24/7."
  exit 1
elif (( fail > 0 )); then
  echo "  ${red}VERDICT: FAIL${rst}  (${fail} non-critical criteria failed)"
  exit 1
elif (( partial > 0 )); then
  echo "  ${yel}VERDICT: PARTIAL${rst}  (${partial} criteria amber — human review)"
  exit 2
else
  echo "  ${green}VERDICT: PASS${rst}  (all 12 criteria green) — system worth 24/7."
  exit 0
fi
