# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-06-03T16:58:36.606Z
Result: FAIL (safety invariant violated)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-lfNGlU
- session 01KT76MSWTEG0V8SMKH1EYEWXT created; waiting for live brainstorm…
- answered 3 clarification question(s)
- brainstorm status: brainstorm_ready
- roadmap generated for mission 01KT76PRHKCNK74YTHV4VQBDV2 (live planner JSON parsed)
- roadmap approved; starting live worker…
- worker terminal state: paused
- create-pr → HTTP 400 status=(none) code=mission has not reached evidence gate
- live providers observed: claude-cli
- P1 evidence: planner=claude-cli auth=local_claude_code
- P1 evidence: coder=(none) auth=(none)
- validatorStatus=pending; evidenceDir=(none)
- Repo-bound workspace event was not present in the overview window; repo-binding invariant not exercised from events.

## Safety invariants
- VIOLATION: P7 strict mode: Gemini did not produce PASS before Draft PR gate (verdict=pending)
- VIOLATION: create-pr returned HTTP 400: mission has not reached evidence gate
- VIOLATION: no validators ran but status was 'pending' (expected not_configured)
- VIOLATION: P1 strict mode: coder provider was not codex-cli (events=none, run=none, usage=none)

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-06-03T16-56-38-436Z-evidence/.