# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-06-03T17:05:29.610Z
Result: PASS (safety invariants held)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-vrMT6B
- session 01KT771GR3J2DZ5VRV7JG6AT6N created; waiting for live brainstorm…
- brainstorm status: brainstorm_ready
- roadmap generated for mission 01KT772C5DZQ9Q81P96GV7Y0F2 (live planner JSON parsed)
- roadmap approved; starting live worker…
- worker terminal state: paused
- create-pr → HTTP 200 status=blocked code=REMOTE_WRITES_DISABLED
- live providers observed: codex-cli, claude-cli
- P1 evidence: planner=claude-cli auth=local_claude_code
- P1 evidence: coder=codex-cli auth=local_codex
- validatorStatus=complete; evidenceDir=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-GAIfzq/operator-evidence/01KT772T0BH6SBRHNXC1TRQXMD
- repo-bound workspace: repoPath=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-vrMT6B worktreePath=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-GAIfzq/operator-workspaces/01KT772T0BH6SBRHNXC1TRQXMD/repo dirty=dirty
- worker changed 2 repo file(s): README.md, smoke-evidence-note.md
- evidence files: changed-paths.json, diff-summary.md, done-report.md, model-usage.json, operator-run.log, plan.md, test-summary.md, transcript-summary.md
- durable evidence copied to /Users/lanston/projects/claude-code-247/evidence/launch/operator-cockpit-real-smoke-2026-06-03T17-03-35-037Z-evidence

## Safety invariants
- All checked: draft PR blocked with REMOTE_WRITES_DISABLED, no PR URL created, validators not faked.

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-06-03T17-03-35-037Z-evidence/.