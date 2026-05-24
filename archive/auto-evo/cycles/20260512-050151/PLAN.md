# Cycle 20260512-050151 PLAN — Track R2 (Codex cross-model reviewer)

## Target dim
R (Review)

## Specific gap being closed
R-dim L5 requires "cross-model second opinion (Codex CLI)". Today the
infrastructure does not exist. Codex CLI is also not currently on the
host PATH — so this cycle BUILDS the integration honestly:
- write `orchestrator/codex_reviewer.py` (module that shells out to
  the user's local Codex CLI subscription, returns a structured verdict,
  triggers ALERT.md on Claude/Codex disagreement)
- write `tests/test_codex_reviewer.py` (mocks subprocess so tests don't
  require Codex; ≥ 6 tests)
- update `scripts/compute_level.py` so R-L5 requires BOTH the bridge
  artifact AND `codex` resolvable on PATH (via `shutil.which`)

This keeps the rubric honest: R stays at L3 in `LEVEL.md` until the user
installs Codex locally. Once they do, the bridge is already wired and
R will auto-promote on the next `compute_level` run.

## Change being made

1. `orchestrator/codex_reviewer.py`:
   - `codex_available() -> bool` (probes `shutil.which("codex")`)
   - `run_codex_review(diff: str, prompt_path: Path | None) -> CodexVerdict`
     - dataclass: `CodexVerdict(available: bool, verdict: str, raw_output: str, error: Optional[str])`
     - if `not codex_available()`: returns `verdict="codex_unavailable"`
       without any subprocess call
     - else: subprocess.run(["codex", "--print", "-p", ...], input=diff)
       with a strict timeout
   - `disagreement_protocol(claude_verdict, codex_verdict) -> Optional[str]`
     returns a reason string when the two disagree on PASS/FAIL, None otherwise
   - `write_alert(reason, alert_path) -> None`

2. `tests/test_codex_reviewer.py`:
   - mocks `shutil.which` and `subprocess.run` so the tests pass without
     Codex installed
   - ≥ 6 tests: availability detection, subprocess invocation, output
     parsing, disagreement protocol, ALERT.md emission, real-repo
     skipif-no-codex integration

3. `scripts/compute_level.py`:
   - update `REVIEW_MARKERS["codex_bridge"]` to add an extra
     `requires_path` field, checked via `shutil.which` in `review_dim`
   - update self-tests (regression in `test_review_l5_when_codex_active`
     to also mock the PATH check)

## Acceptance criteria
- [ ] `orchestrator/codex_reviewer.py` exists with the three callables
- [ ] `tests/test_codex_reviewer.py` has ≥ 6 tests, all green
- [ ] `scripts/compute_level.py` R-dim check now requires `codex` on PATH
- [ ] `tests/test_compute_level.py` still green (25 tests; possibly +1
      for the new PATH check)
- [ ] `pytest -q` full suite green
- [ ] `LEVEL.md` after this cycle: R stays at L3 (codex not on PATH);
      evidence string mentions "bridge present but codex CLI not on PATH"
- [ ] `compute_level.py --check` exits 0

## Files to touch (closed set)
- `orchestrator/codex_reviewer.py` (new)
- `tests/test_codex_reviewer.py` (new)
- `scripts/compute_level.py` (PATH check)
- `tests/test_compute_level.py` (regression update if needed)
- `cycles/20260512-050151/*` (PLAN/RESULT/REPORT/STATE.before/verify-output/proposal)
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Forbidden
- secrets, hand-edit LEVEL.md
- production code other than the new codex_reviewer.py
- existing role prompts, existing tests

## Rollback
`git reset --hard autoevo/pre-20260512-050151`

## Risk score
medium — touches `scripts/compute_level.py` which is L7-critical. The
self-test suite covers it; will run before commit.

## FAILURES.md pre-flight
Preflight flagged FAIL-0003 ("subscription" keyword from the PLAN
mentioning "user's local Codex CLI subscription"). Citing **FAIL-0003**:
that entry is about the Claude subscription auth path (phantom-cost
masking via to_billable_cost). This cycle is about a DIFFERENT
subscription (Codex CLI / OpenAI). The only shared concept is the word
"subscription"; no shared infrastructure or failure mode.

## Open questions
- None.
