#!/usr/bin/env bash
# p5_grade.sh — grade the P5 pilot after 24h.
# Reads /tmp/p5_pilot_issues.txt (issue numbers) and /tmp/p5_pilot_start.txt (start ts).
# Computes: completion rate, merge rate (interactive), blocker rate, median cycle time.

set -uo pipefail

REPO="CTlanston/auto-evo-playground"
ISSUES_FILE="/tmp/p5_pilot_issues.txt"
START_FILE="/tmp/p5_pilot_start.txt"

if [[ ! -f "$ISSUES_FILE" ]]; then
  echo "ERROR: $ISSUES_FILE not found. Run p5_file_issues.sh first."
  exit 1
fi

ISSUE_NUMS=($(cat "$ISSUES_FILE"))
TOTAL=${#ISSUE_NUMS[@]}
START_TS=$(cat "$START_FILE" 2>/dev/null || echo 0)
NOW_TS=$(date -u +%s)
ELAPSED_HOURS=$(( (NOW_TS - START_TS) / 3600 ))

# Colors
green=$'\e[32m'; red=$'\e[31m'; yel=$'\e[33m'; rst=$'\e[0m'

echo "═══════════════════════════════════════════════════════════════"
echo "  AutoDev P5 Pilot — Grader"
echo "═══════════════════════════════════════════════════════════════"
echo
echo "  Repository:       $REPO"
echo "  Issues filed:     $TOTAL"
echo "  Issue numbers:    ${ISSUE_NUMS[*]}"
echo "  Elapsed:          ${ELAPSED_HOURS}h since filing"
echo

# ──────────────────────────────────────────
# Metric 1: Completion rate
# ──────────────────────────────────────────
REACHED_HUMAN_REVIEW=0
FAILED_OR_BLOCKED=0
STILL_IN_PROGRESS=0

declare -A ISSUE_STATUS
declare -A ISSUE_PR
declare -A ISSUE_CYCLE_TIME

for n in "${ISSUE_NUMS[@]}"; do
  status=$(sqlite3 /Users/lanston/projects/claude-code-247/state/orchestrator.db \
    "SELECT status FROM tasks WHERE issue_id=$n LIMIT 1;" 2>/dev/null || echo "")

  ISSUE_STATUS[$n]="$status"

  # Get PR for this issue's shadow branch (if any)
  pr_num=$(gh pr list --repo "$REPO" --head "shadow/issue-$n" --state all --json number --jq '.[0].number // empty' 2>/dev/null)
  ISSUE_PR[$n]="$pr_num"

  # Cycle time: from filing to last status update in DB
  cycle_finished=$(sqlite3 /Users/lanston/projects/claude-code-247/state/orchestrator.db \
    "SELECT updated_at FROM tasks WHERE issue_id=$n LIMIT 1;" 2>/dev/null || echo "")
  if [[ -n "$cycle_finished" ]] && [[ -n "$START_TS" ]]; then
    cycle_min=$(( (${cycle_finished%%.*} - START_TS) / 60 ))
    ISSUE_CYCLE_TIME[$n]=$cycle_min
  fi

  case "$status" in
    human_review)
      REACHED_HUMAN_REVIEW=$((REACHED_HUMAN_REVIEW+1))
      ;;
    failed|blocked)
      FAILED_OR_BLOCKED=$((FAILED_OR_BLOCKED+1))
      ;;
    "")
      # No row in DB — might not have been ingested or might still be queued
      STILL_IN_PROGRESS=$((STILL_IN_PROGRESS+1))
      ;;
    *)
      STILL_IN_PROGRESS=$((STILL_IN_PROGRESS+1))
      ;;
  esac
done

COMPLETION_PCT=$(( 100 * REACHED_HUMAN_REVIEW / TOTAL ))
BLOCKER_PCT=$(( 100 * FAILED_OR_BLOCKED / TOTAL ))

# ──────────────────────────────────────────
# Per-issue summary table
# ──────────────────────────────────────────
echo "── Per-issue status ──"
printf "  %-8s %-15s %-12s %s\n" "ISSUE" "STATUS" "PR" "CYCLE_MIN"
for n in "${ISSUE_NUMS[@]}"; do
  status="${ISSUE_STATUS[$n]:-<not in db>}"
  pr="${ISSUE_PR[$n]:-(none)}"
  cycle_min="${ISSUE_CYCLE_TIME[$n]:-?}"
  printf "  #%-7s %-15s #%-11s %s\n" "$n" "$status" "$pr" "$cycle_min"
done
echo

# ──────────────────────────────────────────
# Metric 2: Merge rate (interactive)
# ──────────────────────────────────────────
echo "── Merge rate — your manual judgment ──"
echo
echo "For each PR below, click and quickly skim the diff. Decide: 'Would I merge this?'"
echo "Type 'y' (merge), 'n' (no), or 's' (skip — needs more review)."
echo

WOULD_MERGE=0
DECIDED=0
for n in "${ISSUE_NUMS[@]}"; do
  pr="${ISSUE_PR[$n]:-}"
  if [[ -z "$pr" ]]; then
    continue
  fi
  url="https://github.com/$REPO/pull/$pr"
  echo "  Issue #$n → PR #$pr"
  echo "  URL: $url"
  read -r -p "  Would you merge? [y/n/s]: " ans
  case "$ans" in
    y|Y) WOULD_MERGE=$((WOULD_MERGE+1)); DECIDED=$((DECIDED+1)) ;;
    n|N) DECIDED=$((DECIDED+1)) ;;
    *) ;;  # skip
  esac
done

if (( DECIDED > 0 )); then
  MERGE_PCT=$(( 100 * WOULD_MERGE / TOTAL ))
else
  MERGE_PCT=0
fi
echo

# ──────────────────────────────────────────
# Metric 3: Median cycle time
# ──────────────────────────────────────────
ALL_CYCLE_TIMES=""
for n in "${ISSUE_NUMS[@]}"; do
  if [[ -n "${ISSUE_CYCLE_TIME[$n]:-}" ]]; then
    ALL_CYCLE_TIMES+="${ISSUE_CYCLE_TIME[$n]}\n"
  fi
done

if [[ -n "$ALL_CYCLE_TIMES" ]]; then
  MEDIAN_MIN=$(printf "$ALL_CYCLE_TIMES" | sort -n | awk '
    { a[NR]=$1 }
    END {
      n = NR;
      if (n % 2 == 1) print a[(n+1)/2];
      else print (a[n/2] + a[n/2+1]) / 2;
    }')
else
  MEDIAN_MIN="N/A"
fi

# ──────────────────────────────────────────
# Verdict
# ──────────────────────────────────────────
echo
echo "═══════════════════════════════════════════════════════════════"
echo "                    P5 PILOT RESULTS"
echo "═══════════════════════════════════════════════════════════════"
echo
printf "  Total issues filed:        %d\n" "$TOTAL"
printf "  Reached human_review:      %d  (%d%%)\n" "$REACHED_HUMAN_REVIEW" "$COMPLETION_PCT"
printf "  You would merge:           %d  (%d%%)\n" "$WOULD_MERGE" "$MERGE_PCT"
printf "  Blocked/failed:            %d  (%d%%)\n" "$FAILED_OR_BLOCKED" "$BLOCKER_PCT"
printf "  Still in progress:         %d\n" "$STILL_IN_PROGRESS"
printf "  Median cycle wall time:    %s min\n" "$MEDIAN_MIN"
echo

# Verdict
PASS_COUNT=0
(( COMPLETION_PCT >= 70 )) && PASS_COUNT=$((PASS_COUNT+1))
(( MERGE_PCT >= 50 )) && PASS_COUNT=$((PASS_COUNT+1))
(( BLOCKER_PCT <= 20 )) && PASS_COUNT=$((PASS_COUNT+1))
[[ "$MEDIAN_MIN" != "N/A" ]] && [[ "$MEDIAN_MIN" -le 60 ]] && PASS_COUNT=$((PASS_COUNT+1))

if (( PASS_COUNT == 4 )); then
  echo "  ${green}VERDICT: PASS${rst} — System delivers on real issues. Move to P6 (auto-travel)."
elif (( PASS_COUNT >= 2 )); then
  echo "  ${yel}VERDICT: PARTIAL${rst} — System works for some tasks. ${PASS_COUNT}/4 thresholds met."
  echo "  Next: investigate which issue types failed; 1-2 fix cycles; retry P5."
else
  echo "  ${red}VERDICT: FAIL${rst} — System doesn't reliably deliver. ${PASS_COUNT}/4 thresholds met."
  echo "  Next: reassess scope or accept as research project, not production tool."
fi
echo

# ──────────────────────────────────────────
# Write report
# ──────────────────────────────────────────
REPORT_PATH="/Users/lanston/projects/claude-code-247/reports/p5-pilot-verdict.md"
cat > "$REPORT_PATH" <<EOF
# P5 Pilot Verdict

**Generated**: $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Window**: ${ELAPSED_HOURS}h since filing
**Issues filed**: $TOTAL — ${ISSUE_NUMS[*]}

## Metrics

| Metric | Value | Threshold |
|--------|-------|-----------|
| Completion rate (human_review) | $COMPLETION_PCT% | ≥ 70% |
| Merge rate (your judgment) | $MERGE_PCT% | ≥ 50% |
| Blocker/fail rate | $BLOCKER_PCT% | ≤ 20% |
| Median cycle wall time | $MEDIAN_MIN min | ≤ 60 min |

**Thresholds met**: $PASS_COUNT / 4

## Verdict

EOF

if (( PASS_COUNT == 4 )); then
  echo "**PASS** — System delivers on real issues. Next step: P6 (auto-travel integration)." >> "$REPORT_PATH"
elif (( PASS_COUNT >= 2 )); then
  echo "**PARTIAL** — System works for some tasks but not all. Next step: diagnose + 1-2 fix cycles + retry P5." >> "$REPORT_PATH"
else
  echo "**FAIL** — System doesn't reliably deliver. Next step: reassess scope or accept as research project." >> "$REPORT_PATH"
fi

echo "" >> "$REPORT_PATH"
echo "## Per-issue breakdown" >> "$REPORT_PATH"
echo "" >> "$REPORT_PATH"
echo "| Issue | Status | PR | Cycle min |" >> "$REPORT_PATH"
echo "|-------|--------|-----|-----------|" >> "$REPORT_PATH"
for n in "${ISSUE_NUMS[@]}"; do
  status="${ISSUE_STATUS[$n]:-N/A}"
  pr="${ISSUE_PR[$n]:-N/A}"
  cycle_min="${ISSUE_CYCLE_TIME[$n]:-N/A}"
  echo "| #$n | $status | #$pr | $cycle_min |" >> "$REPORT_PATH"
done

echo "Report written to: $REPORT_PATH"

if (( PASS_COUNT == 4 )); then
  exit 0
elif (( PASS_COUNT >= 2 )); then
  exit 2
else
  exit 1
fi
