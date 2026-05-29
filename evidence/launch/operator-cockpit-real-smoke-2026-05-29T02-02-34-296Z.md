# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-05-29T02:02:34.296Z
Result: PASS (safety invariants held)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-DP6KTk
- session 01KSRQAZZNEDHJ6XQKT6Q99AAX created; waiting for live brainstorm…
- brainstorm status: brainstorm_ready
- roadmap generated for mission 01KSRQBZADTD484W132XDXPA6V (live planner JSON parsed)
- roadmap approved; starting live worker…
- worker terminal state: paused
- create-pr → status=blocked code=REMOTE_WRITES_DISABLED
- live providers observed: codex-cli, claude-cli
- validatorStatus=not_configured; evidenceDir=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-PNfc51/operator-evidence/01KSRQCYBZBBYVYSA8S2JXJE1J
- evidence files: diff-summary.md, done-report.md, model-usage.json, operator-run.log, plan.md, test-summary.md, transcript-summary.md

## Safety invariants
- All checked: draft PR blocked with REMOTE_WRITES_DISABLED, no PR URL created, validators not faked.

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.