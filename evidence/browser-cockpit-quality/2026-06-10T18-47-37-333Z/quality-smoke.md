# Operator Cockpit WebUI Quality Smoke

Result: PASS
Mission: 01KTSDS5V46NHK5TJAEHRFRTNE
Stage: pr_blocked
PR gate: GEMINI_NOT_CONFIGURED

Assertions:
- cockpit renders as one conversation column plus the three-part status strip
- legacy Project Pulse, sidebar, inspector, and tabbed panels are absent
- one primary action per stage
- stable testids for core controls
- planner/worker provider badges expose mock test mode
- PR URL stayed empty while Gemini hard gate was not configured
- draft PR blocked card reassures no push, PR, or merge occurred
- browser console had no error/warning