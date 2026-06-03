# Operator Cockpit WebUI Quality Smoke

Result: PASS
Mission: 01KT4SXPEXQ8Y5XM60AN9RG9CJ
Stage: pr_blocked
PR gate: REMOTE_WRITES_DISABLED

Assertions:
- one primary action per stage
- stable testids for core controls
- planner/worker provider badges expose mock test mode
- PR URL stayed empty under REMOTE_WRITES_DISABLED
- draft PR blocked card reassures no push, PR, or merge occurred
- browser console had no error/warning