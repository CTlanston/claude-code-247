# Claude Code 247 Harness Intent

## Outcome

Claude Code 247 must become a real 24x7 harness and operation system that can continuously call Claude Code as the coder for real repositories.

Fairshare is the first live workload used to expose harness gaps, validate fixes, and prove the loop can keep operating without Codex directly writing workload code.

## Roles

- Claude Code 247 owns orchestration: registration, cadence, state, evidence, gates, PR creation, merge policy, HOLD, and doctor reporting.
- Claude Code is the coder role for the Fairshare workload.
- Codex acts as harness operator and systems improver: inspect evidence, diagnose failures, improve Claude Code 247, open/merge harness PRs after validation, sync the local service, and verify the next live cycle.
- Codex should not routinely edit Fairshare workload code directly; doing so would contaminate the Claude Code coder test.

## Current Priority

First make the CLI, launchd, JSON doctor, summaries, logs, and evidence reliable enough for 24x7 operation.

Dashboards, fleet-wide UI, and multi-workload management are useful later, but they must not replace the immediate requirement that the local operation loop can run and explain itself.

## Success Criteria

A live workload loop is considered healthy when all of these are true:

- The workload is registered with launchd and runs on the configured cadence.
- `doctor --launchd-label <label> --json` reports the effective config and runtime state.
- The coder provider is fixed to `claude` for the Fairshare loop; there is no Codex fallback for workload coding.
- Each cycle either completes with green gates and an allowed PR/merge, or enters HOLD with evidence, a reason, and an operator action.
- The summary includes the latest cycle, changed paths, gates, provider, stage durations, token/cost usage when provider data is available, and the next expected run.
- Logs include enough stage events and heartbeats to distinguish a healthy long run from a stuck run.
- Low-value churn such as repeated workbook-only changes or repeated low-signal test-only changes is detected and should force HOLD or stronger task steering.
- Risky operations involving secrets, paid-provider configuration, production deploys, data deletion, or broad migrations must HOLD or ask an operator before proceeding.

## Evidence Standard

Claims about the harness must be proven by current artifacts, not chat memory.

Acceptable evidence includes:

- launchd plist and runtime state
- Autoflow state JSON
- latest summary JSON
- per-cycle evidence directories
- command logs and stage heartbeats
- gate results
- PR state and merge records
- local tests, typecheck, lint, and targeted live-cycle verification

Missing or indirect evidence is not a pass.

## Fairshare Workload Policy

Fairshare is a real product workload, but at this stage its main purpose is to test and improve Claude Code 247.

Fairshare PRs may auto-merge only when the configured gates pass and remote-write policy allows the change. If Claude Code fails, hits a limit, produces no productive change, or touches risky paths, the harness should HOLD with evidence instead of falling back to Codex or silently continuing.

## Operator Loop

The ongoing improvement loop is:

1. Let Fairshare expose real harness behavior under launchd.
2. Inspect doctor, logs, summaries, evidence, and PR state.
3. Improve Claude Code 247 where the harness is unclear, brittle, invisible, or unsafe.
4. Validate with tests and code review.
5. Merge the harness PR.
6. Sync the local Claude Code 247 service.
7. Verify the next Fairshare live cycle.

