# health: score=94 (green)

Generated: 2026-05-13T14:52:02.218590+00:00

## Signals

| signal | value |
|---|---|
| test_status | PASS |
| lint_typecheck | NO_DATA |
| recent_failure_rate | 0.0 |
| stuck_issue_count | 2 |
| guardian_pauses_last_24h | 0 |
| flaky_test_signs | NO_DATA |
| large_diff_signs | 0 |
| untracked_file_risk | clean |
| cost_budget_remaining_pct | 100.0 |

## Thresholds (per L7 §10)

- 90-100 green:     dispatch normally
- 70-89  usable:    dispatch with WARN
- 50-69  degraded:  pause new work
- <50    red:       pause everything; require human
