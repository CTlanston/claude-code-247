# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-06-03T15:34:07.302Z
Result: FAIL (safety invariant violated)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-repo-BK0m0l
- session 01KT71R6G8JCB508SZ84N6HQX4 created; waiting for live brainstorm…
- brainstorm status: TIMEOUT

## Safety invariants
- VIOLATION: fatal: POST /operator/sessions/01KT71R6G8JCB508SZ84N6HQX4/generate-roadmap → HTTP 409

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-06-03T15-31-06-779Z-evidence/.