# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-05-31T07:36:38.179Z
Result: PASS (safety invariants held)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /tmp/claude-501/aedev-real-smoke-repo-u87ZMM
- session 01KSYF9ATYP2PVD48KJCR901ZV created; waiting for live brainstorm…
- brainstorm status: brainstorm_ready
- roadmap generated for mission 01KSYFAQW567XR1VEYMYBV2QAC (live planner JSON parsed)
- roadmap approved; starting live worker…
- worker terminal state: paused
- create-pr → HTTP 200 status=blocked code=REMOTE_WRITES_DISABLED
- live providers observed: codex-cli, claude-cli
- validatorStatus=not_configured; evidenceDir=/tmp/claude-501/aedev-real-smoke-state-8mrWtz/operator-evidence/01KSYFBKSSYVHMPMV36HGJ9Y1A
- repo-bound workspace: repoPath=/tmp/claude-501/aedev-real-smoke-repo-u87ZMM worktreePath=/tmp/claude-501/aedev-real-smoke-state-8mrWtz/operator-workspaces/01KSYFBKSSYVHMPMV36HGJ9Y1A/repo dirty=clean
- worker changed 2 repo file(s): README.md, cockpit-smoke-note.md
- evidence files: changed-paths.json, diff-summary.md, done-report.md, model-usage.json, operator-run.log, plan.md, test-summary.md, transcript-summary.md
- durable evidence copied to /Users/lanston/projects/claude-code-247/evidence/launch/operator-cockpit-real-smoke-2026-05-31T07-34-29-846Z-evidence

## Safety invariants
- All checked: draft PR blocked with REMOTE_WRITES_DISABLED, no PR URL created, validators not faked.

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-05-31T07-34-29-846Z-evidence/.