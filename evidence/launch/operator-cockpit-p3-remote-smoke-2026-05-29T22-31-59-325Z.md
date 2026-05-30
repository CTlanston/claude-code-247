# Operator Cockpit — P3 Live Remote-Write Smoke

Date: 2026-05-29T22:32:07.965Z
Repo: CTlanston/aedev-p3-smoke (disposable)
Result: PASS
Draft PR: #2 https://github.com/CTlanston/aedev-p3-smoke/pull/2 (state=open)

## Timeline
- cloned CTlanston/aedev-p3-smoke; base=main; branch=p3-smoke-2026-05-29T22-31-59-325Z
- made a local commit on the branch (not pushed yet)
- gate OFF -> blocked REMOTE_WRITES_DISABLED (expected)
- confirmed: no remote branch exists after the blocked attempt
- gate ON -> draft PR #2 https://github.com/CTlanston/aedev-p3-smoke/pull/2 (state=open, draft=true)
- verified PR #2: isDraft=true state=OPEN mergedAt=null
- idempotent re-run -> same PR #2; open PRs for branch = 1

## Safety invariants
- gate blocked with REMOTE_WRITES_DISABLED when off (no branch pushed); draft PR created when on; PR is a DRAFT and was never merged; idempotent re-run reused the same PR.

## Notes
- allow_remote_writes was passed true ONLY in-process for this disposable repo; no config file was modified, so the global default stays false.
- No merge was performed. The draft PR is left open for inspection.
