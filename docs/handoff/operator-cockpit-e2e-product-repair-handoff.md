# Operator Cockpit — E2E Product Repair · Trigger Handoff

> **This file IS the trigger** for the `operator-cockpit-e2e-repair-loop` Scheduled Task.
> Its existence starts **Round 1** on the next ~15-min poll. Authored 2026-05-31 by the
> operator's setup session as the starting input for the repair loop.
> Loop workbook: `docs/execution-workbooks/operator-cockpit-e2e-repair-loop.md`.

## Status
- **Partial / supervised-RC.** The system is a well-architected, safety-disciplined control
  plane that works as a *supervised single-operator assistant* — it is **not yet** proven for
  unattended 24/7 production use. This handoff hands the repair loop the job of driving the
  Operator Cockpit end-to-end in a **real browser**, finding the real blocking defects, fixing
  them, and merging — round by round — until it is production-fluid.
- **Do not treat any "done"/"green" claim below as proof.** Reconcile every item against the
  live system in Round 1; this handoff is a *to-do hypothesis*, not a verification.

## Baseline
- Repo: `/Users/lanston/projects/claude-code-247`
- Branch/HEAD to test from: **`main` = `fc644cf`** (Merge PR #22 "operator-cockpit repo-bound worker"); `codex/v24-vertical-slice` is in sync (0 ahead/0 behind). Round each branches a fresh `codex/...` from `origin/main`.
- NOTE: `PRODUCTION_WORKBOOK.md` §0 / older handoffs still say HEAD `1dbc2e5` / "13 ahead" — **stale**; PRs merged through #22 since. Trust the tree, not the docs.

## What is delivered (verify, don't trust)
- **Architecture:** TypeScript-only, event-sourced, three-plane (daemon · workers · operator). 24 packages under `packages/`, 1 `apps/dashboard`, ADRs 0007–0021, **110 `*.test.ts(x)` files**.
- **Operator Cockpit UI** (`apps/dashboard/`): pages cockpit / missions / tasks / approvals / memory; cockpit subcomponents ChatThread, ClarificationCard, ExecutionTimeline, Composer, Sidebar. Chat-first workspace, structured clarification gate (ADR-0020), live execution timeline, provider/token transparency, PR-safety-gate display.
- **Safety invariants (a real strength):** no-auto-merge, no-self-approval, dual-validator, forbidden-paths + secret-pattern guards, draft-PR gate — test-enforced.
- **Dual validators** (Gemini + OpenAI, real REST, evidence-only).
- **E2E-1 recorded GREEN** (committed evidence): one real Claude-in-Docker run with model_usage + dual-family validators + real **draft** PRs #12/#13 on `CTlanston/multi-agent-brainstorm`. **E2E-2** structured clarification gate built/green.
- **Build verification (fresh, on `fc644cf`, 2026-05-31):** `pnpm typecheck` PASS (exit 0) · `pnpm lint` PASS (exit 0) · `pnpm test` **646 passed / 6 env-gated skips across 110 files** (exit 0, ~55s). The build is healthy at unit/integration level — but this says NOTHING about real-browser behavior; the live UI E2E is exactly Round 1's job.

## What still needs improvement for 7×24 production (candidate gaps — reconcile vs current HEAD)
Derived from the 2026-05-29 grounded audit (`docs/handoff/production-readiness-assessment-2026-05-29.md`); some may have closed since E2E-1 went green and #12–#22 merged — **Round 1 verifies each against `fc644cf`:**
1. **Real-browser / real-desktop E2E of the Operator Cockpit has never been done** — only deterministic (mock) Playwright + screenshots. This is the loop's core mission.
2. **Install / 24-7 boot path** (launchd) reported broken/stale (missing `install_launchd.sh`?, INSTALL/OPERATIONS describe wrong runtime/port). Verify on current HEAD.
3. **Real-clock soak (≥24h)** never run — all soaks synthetic (ADR-0013/0021 concede this).
4. **Autonomous core loop realness** — E2E-1 proved one operator-directed run; confirm Docker worker + GitHub push path are real, repeatable, and not default-skipped/stubbed.
5. **Secrets enforcement** (ADR-0007) may be types-only — verify grant/TTL/revoke/inject.
6. **Cockpit L3 multi-round clarification walk** pending per the workbooks.
7. **UI robustness:** error / empty / failure-recovery states, narrow/mobile layout, refresh & re-entry state-consistency — untested in a real browser.
8. **Docs accuracy** (INSTALL / OPERATIONS) — stale per audit.

## Known open issues / defects (Round 1 head-start — assign REAL severity from observed behavior)
- [P1·verify] No real-browser E2E coverage of cockpit pages (#1 above) — the loop's primary task.
- [P1·verify] Install/24-7 boot may be broken (#2).
- [P2·verify] No real-clock soak (#3); secrets possibly types-only (#5); L3 walk pending (#6).
- [P2·verify] UI error/empty/recovery + narrow-layout + refresh-consistency gaps (#7).
- [P3] Stale INSTALL/OPERATIONS docs (#8).
> Round 1 must independently re-test in a real browser and set severities from what it actually observes, not from this list.

## Out of scope / do-not-touch
- The daemon's global `system.allow_remote_writes` — **leave it `false`** (it gates the OTHER managed repos `auto-evo-playground` / `multi-agent-brainstorm`, which you must NOT write to).
- `~/.claude-code-247/repos.yaml` — do not modify/enable entries.
- Forbidden paths: `.env*`, `secrets/**`, `.github/**`, `AGENTS.md`, `CLAUDE.md`.
- `archive/auto-evo/` (no imports). The concurrent "Codex builder" branch + the primary working tree (work in a dedicated worktree).

## Entry point for Round 1
1. `pnpm install --frozen-lockfile`; `pnpm cockpit:dev` → daemon :7247 + cockpit :7248; verify health.
2. **First, do the real-browser E2E walk of every cockpit page** (Chrome MCP / preview) to discover the actual current-state defects on `fc644cf` — that is the point of this loop.
3. Record findings in the workbook with real severities; fix highest-severity confirmed bugs surgically; re-verify; green-only auto-merge your own PR to `main`; write the Round 1 handoff.

## Remote-write state
- Global `allow_remote_writes` = **false** (keep). `claude-code-247` is intentionally **not** in `repos.yaml` (it's the system, not a managed target).
- The loop has **operator standing approval (2026-05-31)** to push + merge its OWN *green* PRs for `claude-code-247` to `main` via its own `git`/`gh` — scoped to THIS repo only. `gh` is authed (CTlanston, `repo`+`workflow`). If `main` has branch protection that blocks the merge → HOLD + notify, keep the PR ready.
