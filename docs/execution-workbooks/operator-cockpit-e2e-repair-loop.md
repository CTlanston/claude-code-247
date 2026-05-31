<!-- LOOP STATE — machine-readable; the scheduled task reads/updates this block every round. Do not hand-edit unless you know what you're doing. -->
```yaml
# operator-cockpit-e2e-repair-loop — LOOP STATE (machine-readable)
loop_status: running          # waiting | running | exited
rounds_completed: 1
consecutive_clean_rounds: 1    # full real-E2E rounds on main with NO open P0/P1/P2; exit needs 2 in a row
last_round_utc: 2026-05-31T16:02:43Z
exit_satisfied: false
```

# Operator Cockpit — E2E Repair Loop Workbook

> Driven by the Claude Code **Scheduled Task** `operator-cockpit-e2e-repair-loop`
> (`~/.claude/scheduled-tasks/operator-cockpit-e2e-repair-loop/SKILL.md`, fires hourly).
> Each run is **memoryless** — all loop state lives in this file (+ an ephemeral lock/heartbeat
> under `~/.aedev/e2e-repair-loop/`). Created 2026-05-31.

## Purpose

Continuously advance the *follow-up* repair closed-loop for the Operator Cockpit:
**run the real system → drive the Web UI end-to-end in a real browser → record every real
defect here → fix confirmed bugs → open a safety-gated PR → hand off → repeat**, until the
system is production-fluid with no blocking bugs.

## Trigger (gate)

A repair round runs **only** when the upstream task's sentinel handoff exists:

```
docs/handoff/operator-cockpit-e2e-product-repair-handoff.md
```

While that file is **absent**, every hourly run only writes a waiting heartbeat to
`~/.aedev/e2e-repair-loop/status.log` and changes nothing (no code, no commit, no session).
See `docs/handoff/operator-cockpit-e2e-product-repair-handoff.TEMPLATE.md` for the contract.

## Runtime facts (verified on disk 2026-05-31)

- Start: `pnpm cockpit:dev` → daemon **:7247** + Operator Cockpit (Vite) **:7248**.
- Home is split: **`~/.aedev/`** = daemon state (`state.db`, `state/events-YYYY-MM.ndjson`,
  `e2e-evidence/`); **`~/.claude-code-247/`** = `config.yaml`, `repos.yaml`, `logs/holds.md`,
  `workspaces/`. `~/.Codex-247/` does not exist.
- The daemon's global `system.allow_remote_writes` stays **false** (protects the OTHER managed
  repos `auto-evo-playground` / `multi-agent-brainstorm`; resolved by `remote-write-policy.ts`).
- **Merge authority (operator standing approval 2026-05-31):** this loop may push + merge its OWN
  *green* PRs for `claude-code-247` (origin `CTlanston/claude-code-247`) to `main` via its own
  `git`/`gh`, **scoped to THIS repo only** and independent of the global flag. All round work
  happens in a dedicated git worktree under `~/.aedev/e2e-repair-loop/`, never the primary tree.

## Severity legend

- **P0** — blocks startup or a core flow; dead-end / data loss / crash. Must fix before "clean".
- **P1** — major flow broken or badly degraded; no safe workaround. Must fix before "clean".
- **P2** — real bug with a workaround, or inconsistent state. Must fix before "clean".
- **P3** — polish / cosmetic / minor. Does not block production-readiness exit.

## Per-round section schema (each round appends one `## Round N` block)

- Timestamp (UTC) · branch / commit · handoff read · startup method
- Real flows tested (which pages / interactions, which browser tool)
- Evidence (command output, console/network logs, screenshot notes, DB/state observations, stacks)
- Defect list — each with: severity (P0/P1/P2/P3) · repro steps · user impact ·
  classification (confirmed bug / flaky / risk / polish / out of scope) · fix recommendation
- Fixes made this round + verification results (tests + re-run E2E)
- PR / merge status (and gate state) · any HOLDs
- Decision: allowed to proceed to repair this round? · continue to next round?

---

## Round 0 — bootstrap (2026-05-31, not a test round)

- Workbook + trigger contract created. No system run, no E2E, no defects assessed yet.
- `loop_status: waiting` — awaiting the upstream sentinel handoff before Round 1.
- `consecutive_clean_rounds: 0`. This bootstrap entry does NOT count as a clean round.

<!-- Round 1+ sections are appended below by the scheduled task once triggered. -->

## Round 1 — 2026-05-31T16:02:43Z (UTC)

- **Branch / commit:** `codex/e2e-repair-round-1-20260531` from `origin/main` = `fc644cf`
  (Merge PR #22, repo-bound worker). Worktree: `~/.aedev/e2e-repair-loop/wt-1`. No code changes
  this round (verification round — no confirmed cockpit defect found to fix).
- **Handoff read:** the upstream trigger sentinel
  `docs/handoff/operator-cockpit-e2e-product-repair-handoff.md` (Round 1 input). Reconciled against
  reality: `git fetch` clean; `origin/main` HEAD `fc644cf` matches the sentinel baseline; **0 open
  PRs**; primary tree clean (only this loop's untracked docs). Sentinel's "stale HEAD 1dbc2e5"
  warning confirmed stale — tree is at `fc644cf`. Sentinel's "install_launchd.sh missing?" (#2) is
  **stale**: `scripts/install_launchd.sh`, `scripts/launchd/`, `scripts/uninstall_launchd.sh`, and
  `packages/supervisor/src/launchd.ts` all exist.
- **Startup:** `pnpm install --frozen-lockfile` PASS; `pnpm cockpit:dev` → daemon **:7247** +
  Operator Cockpit (Vite) **:7248**, both health-verified (`/operator/sessions` 200, `/` 200).

### Real flows tested (Chrome MCP — real browser, device "Browser 1", tab 2041296767)

| Flow | Result |
|---|---|
| Dashboard load (`/`) | ✅ 41 requests all 200; **0 console errors**; SSE `/api/events/stream` connected |
| Nav: cockpit / missions / tasks / approvals / memory | ✅ all 5 SPA pages render |
| Missions list | ✅ 25 sessions across states (brainstorm_ready/waiting/cancelled/failed/roadmap_ready/brainstorming) |
| Tasks · 实时执行 | ✅ real lifecycle (done/failed/pending) + workspace + run (`codex-cli:…`) + evidence paths |
| Approvals · 审批工作台 | ✅ 3 pending, decision buttons (Approve/Reject/Open in cockpit); header counter "3 approvals" == `/api/approvals` (3) — **consistent** |
| Memory | ✅ empty state "No memory items yet." renders cleanly |
| Repo registry (`/api/repos`) | ✅ one enabled entry `local-workspace` → this repo; forbiddenPaths enforced |
| New-mission composer ("+ New") | ✅ repo-selector + title + goal render and are fillable. **Live dispatch NOT exercised** — the harness safety classifier blocked the "Start Brainstorm" submit as a worker-pipeline dispatch; respected (not worked around). |
| Failed-mission detail (Hermus 进化, session 01KSXRHX, mission 01KSXT6Q) | ✅ **fully traced**: banner "Worker timed out · 超时 (exit 124)" + remedy; stage pills Intake→…→PR/Waiting/Blocked; Worker codex-cli; Run failed(124); Elapsed 883m; "Draft PR blocked"; SUMMARY result=failed + evidence path; EXECUTION MONITOR tasks/runs/evidence |
| Logs (run log via `/api/missions/.../runs/.../log`) | ✅ returns **53 723 chars** of real codex-cli worker output |
| Refresh / re-entry | ✅ reload renders cleanly, no error text, 0 console errors |
| Multi-round clarification gate (L3) | ✅ observed: user→assistant→clarification cards→PRD across multiple turns in a real session |

### Automated checks (in worktree, on `fc644cf`)

- `pnpm typecheck` → **PASS**
- `pnpm lint` → **PASS**
- `pnpm test` → **110 files, 646 passed / 6 skipped, exit 0** (`~/.aedev/e2e-repair-loop/logs/unit-test.log`)
- `pnpm test:cockpit:e2e` → **"Operator Cockpit deterministic e2e PASS"**, exit 0

### Defect list

**No confirmed P0/P1/P2 cockpit defects found this round.** One earlier suspicion (failed mission
showing no failure banner) was a **false alarm** — it was a misclick on a non-failed session; the
genuinely-failed session renders the full "Worker timed out" trace (verified via `/overview`:
`missionStatus=failed`, `exitCode=124`, 69 events, and the rendered banner). Classification: not a
bug. No fix applied.

### Recorded coverage limitations (NOT defects; carried to Round 2)

- **P-n/a · live worker + draft-PR path not driven** — submitting a brainstorm/Start dispatches the
  daemon worker pipeline; the unattended safety classifier blocked it. Correct behavior; the loop
  must not bypass it. Worker realness is still evidenced indirectly (real failed run + 53KB logs +
  evidence dir from prior runs). *Round 2: consider an operator-attended live run, or a pre-seeded
  test session, to drive Start→Worker→evidence→Draft-PR-gate in the browser.*
- **P-n/a · mobile/narrow viewport not visually verified** — `resize_window` on the managed Chrome
  window did not change the actual viewport (`innerWidth` stayed 1512; `outerWidth` 0). Tooling
  limitation in an unattended run, not an app defect. *Round 2: try Claude Preview viewport presets,
  or static CSS breakpoint review.*
- **P-n/a · daemon-down error banner** — code path exists & handled (`Cockpit.tsx:349-350`
  "Load failed…"), not triggered live (would disrupt the running daemon).
- **Carried verify-items (out of real-browser scope):** #3 ≥24h real-clock soak; #5 secrets
  grant/TTL/revoke realness; #8 INSTALL/OPERATIONS doc accuracy. Not blocking cockpit fluidity;
  none observed as a runtime defect.

### Decision

- Repair work this round: **none needed** — no confirmed defect to fix.
- Round is **CLEAN** for the cockpit real-browser E2E scope (startup ✅, all pages ✅, lifecycle /
  approvals / logs / evidence / repo-status stable ✅, tests + e2e green ✅, no open P0/P1/P2 ✅).
- `consecutive_clean_rounds` → **1**. Continue to Round 2 (exit needs 2 consecutive clean rounds).
- Round 2 should prioritize closing the two coverage gaps above (live worker path + responsive),
  then re-confirm clean.
