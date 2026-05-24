# ADR-0002: Issue preflight — terminalise impossible specs before Coder

## Context

V3 E2E test (2026-05-11) on issue #15 ("test reverse() in src/utils.py")
sat in `coding` state forever:
- Issue body asked for tests of `reverse()` in `src/utils.py`
- `reverse()` did not exist in `src/utils.py`
- Issue body also said: "Do not modify `src/utils.py`"

Coder correctly identified the impossibility and returned BLOCKED. The
orchestrator had no way to terminalise the task — it just re-dispatched
Coder, which kept returning BLOCKED. The supervisor logged a HOLD after N
retries and moved on, but the underlying issue stayed at `coding` forever
in the DB, polluting state and metrics.

Coder was right to refuse. The fix is to catch the impossibility BEFORE
Coder is dispatched, so the task terminalises cleanly at `failed` instead
of looping on `coding → coding → coding`.

## Decision

New module `orchestrator/preflight.py` with `preflight_issue(title, body, repo_root) -> PreflightResult`.

Detection is deliberately narrow: it ONLY flags the specific #15 pattern.
- Extract Python-function-call-like symbols from `title + body`:
  ``backtick-or-bare word followed by `(` ``, blacklisted against common
  Python keywords and ≥3 chars.
- Extract `.py` file paths from `title + body`.
- Scan `title + body` for forbidden-modification phrases (`do not modify`,
  `不要修改`, etc.); within ±200 chars of each phrase, collect the .py paths
  → "forbidden_files".
- For each forbidden file that lives under `src/`, `lib/`, or `orchestrator/`,
  and for each detected symbol: if `def <symbol>(` does NOT appear in that
  file on disk, the spec is **impossible** under its own constraints.

When impossible: return `PreflightResult(ok=False, terminal_status="failed", reason=...)`.

`orchestrator/main.py:_do_planning` calls `preflight_issue` first; if
impossible, it marks the task `failed`, posts a Slack note, and skips
Planner entirely.

## Consequences

Good:
- #15-class issues terminalise cleanly at preflight instead of looping.
- Coder is not dispatched for impossible work (cost savings).
- The "blocked-impossible-spec" reason is human-readable and lists the
  symbol + file pair.
- Narrow detection means valid issues are NOT over-flagged. Five preflight
  unit tests cover false-positive paths (symbol present, no forbidden file,
  forbidden file is a test, etc.).

Bad:
- Other impossibility patterns (unsatisfiable dependency, unreachable test
  environment, etc.) still go to Coder. Preflight is not omniscient. That's
  fine — Coder's own BLOCKED detection handles the rest.
- The regex is deliberately simple. A Unicode-heavy or unusually formatted
  issue might evade detection. Acceptable: we're not building a SAT solver,
  we're catching the one V3 failure mode that cost us hours.

## Alternatives Rejected

- **Have Coder write the impossibility back to the issue body and let the
  state machine catch it later.** Rejected: that's exactly what V3 did and
  it didn't terminalise; the orchestrator kept retrying.
- **Run preflight as an LLM call.** Rejected: an LLM Reviewer-style call is
  expensive and probabilistic. The #15 pattern is detectable with regex +
  AST-equivalent grep at zero cost.
- **Make preflight strict — reject anything ambiguous.** Rejected: false
  positives terminalise tasks that could complete. Narrow is safer.

## Linked regression test

- `tests/test_v4_hardening.py::test_preflight_impossible_spec_reverse_absent`
- `tests/test_v4_hardening.py::test_preflight_passes_when_symbol_present`
- `tests/test_v4_hardening.py::test_preflight_passes_when_no_forbidden_file`
- `tests/test_v4_hardening.py::test_preflight_passes_when_unrelated_issue`
- `tests/test_v4_hardening.py::test_preflight_passes_when_tests_forbidden_but_src_not`
- `tests/test_v4_e2e_replay.py::test_v4_scenario_15_impossible_spec_terminalises_at_preflight`

## Linked cycle

Original implementation: commit `110e7bd` (V4 Track 2, pre-L7).
Ratified into L7 memory: Cycle `20260512-042701` (Bootstrap).
