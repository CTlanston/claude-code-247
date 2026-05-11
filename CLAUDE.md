# CLAUDE.md — repository-level guidance for Claude Code agents

> This file is auto-loaded by Claude Code when it operates inside this repo. It
> is **not** an instruction from a user; treat it as repository policy.

## What this repo is

Two layers stacked on the same codebase:

| Layer | Purpose | Lives in |
| --- | --- | --- |
| **Auto-Evo inner engine** | Original 4-role (Planner / Coder / Reviewer / Guardian) self-evolving system that drives one GitHub Issue → Draft PR through shadow-branch CI | `orchestrator/`, `runner/` |
| **AutoDev v3 outer loop** | Supervisor + state machine + cost policy + recovery + hold-on protocol that wraps the inner engine and survives session death | `autodev/`, `scripts/autodev_*.sh`, `.claude/`, `reports/`, `tasks/`, `commands/` |

The inner engine is **already working** end-to-end against a real GitHub test
repo (`CTlanston/auto-evo-playground`). The outer loop adds: persistent state,
file-based task intake, restart-survivable progress tracking, and a "hold and
move on" pattern when individual tasks get stuck.

## Non-negotiables

1. **Never push to `main`** of any tracked repo.
2. **Never auto-merge PRs.**
3. **Never edit `.env`**, secrets, SSH keys, keychain, or production credentials.
4. **Default to Claude Code CLI / subscription auth.** Do not call the paid
   Anthropic SDK / API unless `HUMAN_CONFIG.md` explicitly permits it AND the
   current cost mode allows it.
5. **No `git push` to remote.** This applies in the v3 implementation phase.
   The supervisor may later push to test-repo shadow branches *after* live
   mode is explicitly enabled by a human edit to `HUMAN_CONFIG.md`.

## Cost modes

- **cheap** (default) — CLI/subscription only. No API. No premium Guardian.
- **balanced** — CLI/subscription + Guardian gating at PR boundary.
- **premium** — Opus Guardian via API allowed only if `cost.daily_usd_cap > 0`
  and `cost.premium_guardian_allowed: true`.

## When blocked

Use the hold protocol from `AUTODEV_V3_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md`
§5: write a `HOLD-<n>` entry to `reports/human-hold.md`, mirror to
`tasks/blockers.md` and `reports/session-log.md`, then **continue with the
next safe task**. Only the critical blockers (repo unreadable, git unusable,
no write permission, CLI dead, missing secrets with no scaffold path) should
halt the whole loop.

## Where to read state

```
reports/state.json          machine-readable supervisor state
reports/session-log.md      timestamped audit trail
reports/daily.md            daily human-readable summary
reports/human-hold.md       blockers needing human action
tasks/current.md            what's being worked on right now
tasks/backlog.md            ordered queue
commands/inbox.md           pause/resume/new-task/set-mode commands
```

## Inner-engine integration points

The inner engine entry point is `orchestrator/main.py`. The supervisor wraps it
via `autodev/inner_engine.py:InnerEngine.run_task()`. **Do not rewrite the
inner engine.** Adapters / wrappers / new modules only.
