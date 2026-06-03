# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-06-03T17:01:31.248Z
Result: FAIL (safety invariant violated)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-mwrUkw
- session 01KT76SW2GERKQPDBHH12HBVAP created; waiting for live brainstorm…
- brainstorm status: brainstorm_ready
- roadmap generated for mission 01KT76TZAF1J1SJ06A0A07CGYN (live planner JSON parsed)
- roadmap approved; starting live worker…
- worker terminal state: run-done
- create-pr → HTTP 200 status=blocked code=GEMINI_NOT_CONFIGURED
- live providers observed: codex-cli, claude-cli
- P1 evidence: planner=claude-cli auth=local_claude_code
- P1 evidence: coder=codex-cli auth=local_codex
- validatorStatus=pending; evidenceDir=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-qSRhgK/operator-evidence/01KT76VH6JWTVWS6318SVQBCVV
- repo-bound workspace: repoPath=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-mwrUkw worktreePath=/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-qSRhgK/operator-workspaces/01KT76VH6JWTVWS6318SVQBCVV/repo dirty=dirty
- worker changed 2 repo file(s): README.md, evidence-note.md
- evidence files: changed-paths.json, diff-summary.md, done-report.md, model-usage.json, operator-run.log, plan.md, test-summary.md, transcript-summary.md
- durable evidence copied to /Users/lanston/projects/claude-code-247/evidence/launch/operator-cockpit-real-smoke-2026-06-03T16-59-24-507Z-evidence

## Safety invariants
- VIOLATION: P7 strict mode: Gemini did not produce PASS before Draft PR gate (verdict=pending)
- VIOLATION: no validators ran but status was 'pending' (expected not_configured)

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-06-03T16-59-24-507Z-evidence/.