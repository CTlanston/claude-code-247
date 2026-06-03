# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-06-03T15:09:16.367Z
Result: PASS (safety invariants held)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-P0Vavd
- session 01KT70BXR4AQWZBN5KA44C4ZCF created; waiting for live brainstorm…
- brainstorm status: brainstorm_ready
- roadmap generated for mission 01KT70D4Y5VBHKCHR96A55QS61 (live planner JSON parsed)
- roadmap approved; starting live worker…
- worker terminal state: paused
- create-pr → HTTP 200 status=blocked code=REMOTE_WRITES_DISABLED
- live providers observed: codex-cli, claude-cli
- P1 evidence: planner=claude-cli auth=local_claude_code
- P1 evidence: coder=codex-cli auth=local_codex
- validatorStatus=not_configured; evidenceDir=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-nssfsz/operator-evidence/01KT70E7ZHR8MACYPPA7S8WP3S
- Repo-bound workspace event was not present in the overview window; repo-binding invariant not exercised from events.
- evidence files: changed-paths.json, diff-summary.md, done-report.md, model-usage.json, operator-run.log, plan.md, test-summary.md, transcript-summary.md
- durable evidence copied to /Users/lanston/projects/claude-code-247/evidence/launch/operator-cockpit-real-smoke-2026-06-03T15-06-56-025Z-evidence

## Safety invariants
- All checked: draft PR blocked with REMOTE_WRITES_DISABLED, no PR URL created, validators not faked.

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-06-03T15-06-56-025Z-evidence/.
