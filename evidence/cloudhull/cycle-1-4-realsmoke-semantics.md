# CloudHull cycles 1–4 — real-smoke semantics hardening (evidence)

Date: 2026-06-11 · Branch: `claude/cloudhull-alpha`
Scope: `scripts/operator-cockpit-real-smoke.ts` PASS/FAIL semantics, extracted
into the pure, unit-tested module `packages/daemon/src/real-smoke-policy.ts`.

## What changed

### Cycle 1 — strict vs fallback-proof modes
- STRICT is now the default (the old opt-in `AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1`
  is retired): PASS requires planner=`claude-cli`/`local_claude_code` AND
  coder=`codex-cli`/`local_codex`. A planner that ran via the honest
  `AEDEV_PLANNER_FALLBACK=codex` path (event marker
  `planner_provider: 'codex-cli (fallback)'` / `fallbackFrom: 'claude-cli'`)
  fails strict mode with `PLANNER_FALLBACK_NOT_ACCEPTED` and a clear reason.
- FALLBACK-PROOF mode only via `AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK=1`:
  accepts the codex fallback planner, but the report header and exit summary
  label the run `DEGRADED (planner fallback)` — never a strict PASS. The
  report records `Requested mode:` and `Achieved mode:` separately.
- `docs/operations/P4-first-real-draft-pr.md` §1.5 now documents both modes
  with commands that match the script; `scripts/aiw-handoff.sh` no longer sets
  the retired REQUIRE_P1 env.

### Cycle 2 — Gemini terminal state
- After the worker completes, the smoke polls `/missions/:id/overview` until
  `resolveValidatorTerminal` reaches a TERMINAL state: `pass` / `fail` /
  `not_configured`, or the timeout `AEDEV_COCKPIT_REAL_SMOKE_VALIDATOR_TIMEOUT_MS`
  (default 180000 ms) elapses → outcome `timeout`.
- A durable `validator-summary.json` (verdicts array + terminal status +
  waited/timeout ms) is always written: into the run's evidence dir when it
  exists (and therefore into the durable evidence copy) AND under
  `evidence/launch/operator-cockpit-real-smoke-<stamp>-validator-summary.json`.
- Timeout produces the distinct failure line `GEMINI_TIMEOUT: …` (non-pass);
  `fail` → `GEMINI_FAIL`; `not_configured` stays honest-acceptable unless
  `AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI=1`. Never a vague "pending".
- The expected create-pr block code follows the terminal state:
  pass→`REMOTE_WRITES_DISABLED`, fail→`GEMINI_NOT_PASS`,
  not_configured→`GEMINI_NOT_CONFIGURED`, timeout→assert blocked only.

### Cycle 3 — required regression evidence
- The sandbox fixture repo now ships a REAL test target: `package.json` with
  `"test": "node test/run-tests.cjs"` (node:assert script printing
  `2 passed, 0 failed`), registered with `testCommands: ['npm test']`. The
  session prompt/clarification answers instruct the coder to run `npm test`
  and record the exact command + result.
- Success (both modes) additionally requires `parseRegressionEvidence` to find
  ≥1 executed test command with PASS across the evidence files
  (test-summary.md, transcript-summary.md, done-report.md, operator-run.log,
  …). Recognized honest shapes: the docker runner's
  ``Runner-verified tests: `cmd` -> exit N`` line, codex `command_execution`
  JSON log lines with `"exit_code"`, and report lines naming a test command
  with an explicit same-line outcome. Absent/failed →
  `REGRESSION_EVIDENCE_MISSING` with the scanned files in the reason.

### Cycle 4 — registered repo path
- `AEDEV_COCKPIT_REAL_SMOKE_SOURCE_REPO=<path>` (+
  `AEDEV_COCKPIT_REAL_SMOKE_REPO_NAME=<name>`, default: path basename)
  registers that repo (enabled) and runs the mission against ITS isolated
  worktree clone; the disposable sandbox remains the default and stays the
  planner's cwd in both cases (the planner CLI never runs inside the real repo).
- The path is validated up front: must exist, be a git work tree, and have a
  HEAD commit — otherwise a clear `SETUP: …` failure (exit 1), never a faked
  sandbox run. A repo name without a path is also a setup error.
- The report header records `Repo source: sandbox` or
  `registered:<name> (<path>)`, and the repo-binding invariants
  (repo_bound_workspace_ready.repoPath, changed-paths.json) are asserted
  against the registered path.

## What is unit-proven here (container CI)

`packages/daemon/src/real-smoke-policy.test.ts` — 38 tests covering: mode
resolution, strict-fails-on-fallback, DEGRADED labeling (never strict PASS),
identical coder requirement in both modes, local-auth enforcement, provider
observation building from overview events (incl. the fallback marker and
model-usage.json/run-mode merging), final label precedence (any failure →
FAIL), validator terminal resolution + GEMINI_TIMEOUT/GEMINI_FAIL/
GEMINI_NOT_CONFIGURED codes, expected PR-block mapping, regression-evidence
parsing (runner-verified, codex command_execution, markdown lines, "0 failed"
handling, bare-mention rejection), and source-repo env resolution.

Full gates on this container: `pnpm typecheck` PASS, `pnpm lint` PASS,
`GIT_CONFIG_GLOBAL=/tmp/test-gitconfig pnpm test` → 135 files,
**988 passed | 6 skipped** (baseline 950 + 38 new, zero regressions).

## What this container can NOT prove (awaits the Mac)

This container has no `claude` / `codex` CLI sessions and no Gemini key, so
the live end-to-end smoke was NOT run and no PASS/DEGRADED is claimed. The
script was executed here only to prove the honest failure paths:

- default strict run → planner HOLD → `FAIL … no execution evidence` (exit 1);
  report kept at `evidence/cloudhull/container-honest-fail-2026-06-11.md`.
- `AEDEV_COCKPIT_REAL_SMOKE_REPO_NAME` without a path → `SETUP:` failure, exit 1.
- `AEDEV_COCKPIT_REAL_SMOKE_SOURCE_REPO=/nonexistent` → `SETUP: registered
  source repo invalid — path does not exist … Refusing to fake a sandbox run`,
  exit 1.

To close on the operator Mac:
1. `pnpm test:cockpit:real-smoke` (strict) — expect `PASS (strict)` with the
   recorded `npm test` PASS and a Gemini terminal state.
2. `AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK=1 AEDEV_PLANNER_FALLBACK=codex`
   with a broken claude session — expect `DEGRADED (planner fallback)`.
3. `AEDEV_COCKPIT_REAL_SMOKE_SOURCE_REPO=… AEDEV_COCKPIT_REAL_SMOKE_REPO_NAME=…`
   against a safe registered repo — expect `Repo source: registered:<name>`.

## Mode semantics

| Run condition | strict (default) | fallback-proof (`ACCEPT_PLANNER_FALLBACK=1`) |
| --- | --- | --- |
| planner=claude-cli, coder=codex-cli | PASS (strict) | PASS (strict) (achieved mode recorded) |
| planner=codex-cli (fallback) | FAIL — `PLANNER_FALLBACK_NOT_ACCEPTED` | DEGRADED (planner fallback), exit 0 |
| coder ≠ codex-cli (or claude as coder) | FAIL | FAIL |
| validator timeout | FAIL — `GEMINI_TIMEOUT` | FAIL — `GEMINI_TIMEOUT` |
| validator fail verdict | FAIL — `GEMINI_FAIL` | FAIL — `GEMINI_FAIL` |
| validator not_configured | acceptable (FAIL only with REQUIRE_GEMINI=1) | same |
| no executed test command with PASS | FAIL — `REGRESSION_EVIDENCE_MISSING` | FAIL — same requirement, reported honestly |
| no execution (planner hold / setup error) | FAIL | FAIL |
