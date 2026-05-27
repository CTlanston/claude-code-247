# HOLD · Stage F3 — Python `git rm` + cutover

**Status:** RESOLVED (approved)
**Reason:** `secret_grant_request`-class (operator-only resolution per workbook §8.1)
**Opened:** 2026-05-27 by session s_0002
**Resolved:** 2026-05-27 by operator (lanston) — explicit statement "F3批准了"
**Resolution:** approved; F3 git rm executed in commit [F3.1] (see git log)
**Authority:** ADR-0011 (operator override paper trail), bound 3

## What F3 would do

Per workbook §3 Stage F3:

```bash
git rm -r orchestrator/ gateway/ runner/ validator/ dashboard/ memory/ pyproject.toml tests/
```

Plus:
- Switch `launchd` plist from `com.claude247.python-orchestrator` (and
  any related entries) to a single `com.claude247.daemon` entry.
- Delete the pytest job from CI (.github/workflows or equivalent).

## Why this is HOLDed

Workbook §1 GROUND RULE 7:

> 任何不可恢复操作（`rm -rf` / `git rm` / `git push --force` / `DROP
> TABLE` / npm publish）必须先登记 HOLD 等待 ApprovalGateway 通过。
> Stage F3 是唯一预批的 `git rm`，但仍须按 §5 L3 走。

`git rm` of a 18,000-line working subsystem is irreversible in the
practical sense — recovery requires git surgery and operator
verification, with downtime risk for any worker still using the Python
plane. Even though F3 is "pre-approved" in the design, the **execution**
requires:

1. Stage F2 dual-site has been running for **at least 7 days** with no
   regression and no rollback request.
2. TS dispatcher carries production load alone for at least 8 hours of
   integration soak.
3. Operator (lanston) explicitly approves this HOLD (L3).

None of those preconditions are met in session s_0002.

## What this session did instead

- Built F1 (shadow diff) and F2 (status-board JSON contract) so the
  preconditions can be evaluated.
- Did NOT touch any file under `orchestrator/ gateway/ runner/
  validator/ dashboard/ memory/ tests/` (verified by `git diff --stat`
  prior to the F3 commit).
- Recorded this HOLD here so the next session and any reviewer sees it
  explicitly.

## How to resolve

When ready to actually cut over:

1. Operator runs the dual-site 7-day observation. Capture screenshots
   to `evidence/stage-F2/L3-validate/`.
2. Operator runs the 8h integration soak. Capture to
   `evidence/stage-F3/L1-acceptance/soak.txt`.
3. Operator opens a NEW session, reads §0 of EXECUTION_WORKBOOK.md,
   confirms `open_holds: 1`, and executes the `git rm` block in a
   commit `[F3.1] python: cutover; accept N/N` after running the soak.
4. Update §0 STATE: `open_holds: 0`, advance `current_stage` to H/I/J/L/M
   parallel.
5. Append §9 entry recording the resolution and screenshot path.

## What would invalidate this hold (force resolution path)

- A red-team prompt successfully exfiltrates a Python file content via
  the TS dispatcher — that would mean both planes are exposed; we
  should *accelerate* cutover, not delay. (Unlikely; bias is the other
  direction.)
- Operator decides v2.1 ships with Python tree intact for one more
  release cycle. In which case F3 is closed `won't-fix-this-cycle` and
  the workbook §3 Stage F3 entry is updated by amendment under §7.4.
