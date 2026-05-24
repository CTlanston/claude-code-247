# Onboarding — AutoDev v3 (`claude-code-247`)

A self-evolving software-engineering loop: 4 inner-engine roles
(Planner / Coder / Reviewer / Guardian) drive one GitHub Issue →
Draft PR per cycle through shadow-branch CI, wrapped by a v3 outer
supervisor that survives session death, tracks state on disk, and
applies a hold-on-blocker protocol.

Mission complete at **Overall L = 5** (2026-05-14). Six rubric
dimensions M/S/R/C/T/E all ≥ L5; five at L7.

## Where to start (in order)

1. **`CLAUDE.md`** — the policy file. Read it. The 5 non-negotiables
   plus the cost-mode rules apply to every action you take here.
2. **`AUTODEV_V3_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md`** — the
   spec the outer loop was built against. `§5` is the hold-on-blocker
   protocol you'll use whenever you can't make progress.
3. **`CONTEXT.md`** — the running architectural map plus all 11
   ADRs. Read the ADR list at the bottom and load any that touch
   what you're about to change.
4. **`LEVEL.md`** — current rubric scores + the evidence backing
   each one. If a change you make would move a dimension, it goes
   here.
5. **`reports/AUTODEV_DONE.md`** — the mission-complete artifact.
   Removing or renaming this restarts the loop; the `PILOT_IN_PROGRESS`
   sentinel overrides it without removal (see Operating section).

## Layered architecture

| Layer | Lives in | Touch policy |
|---|---|---|
| **Inner engine** (Auto-Evo, 4 roles + shadow-branch CI) | `orchestrator/`, `runner/`, `orchestrator/roles/`, `state/orchestrator.db` | **Do not rewrite without architect sign-off.** Adapters / wrappers / new modules only — see `CLAUDE.md`. |
| **Outer loop** (supervisor, state machine, cost policy, hold protocol) | `autodev/`, `scripts/autodev_*.sh`, `.claude/`, `reports/`, `tasks/`, `commands/` | Freely editable. This is where new features land. |
| **Test target** | `CTlanston/auto-evo-playground` GitHub repo (private) | Shadow branches only. Never push to `main`. Never auto-merge. |

## Cost modes

- **cheap** (default) — Claude Code CLI / subscription only. No paid API.
- **balanced** — adds Guardian gating at the PR boundary.
- **premium** — Opus Guardian via API; requires explicit
  `HUMAN_CONFIG.md` permission AND `cost.daily_usd_cap > 0`.

The mode lives in `HUMAN_CONFIG.md`. The supervisor reads it each wake.

## Operating state — where to read it

```
reports/state.json          machine-readable supervisor state
reports/session-log.md      timestamped audit trail (append-only)
reports/daily.md            daily human-readable summary
reports/human-hold.md       blockers needing human action
reports/cycle-history.jsonl per-cycle record
reports/health.{json,md}    current health score (gates dispatch)
reports/AUTODEV_DONE.md     mission-complete sentinel
reports/PILOT_IN_PROGRESS   overrides DONE + STOPSWITCH for pilots
reports/STOPSWITCH          human halt
state/orchestrator.db       inner-engine task state (SQLite)
state/PAUSED                outer-loop pause sentinel
tasks/current.md            what's being worked on right now
tasks/backlog.md            ordered queue
tasks/blockers.md           hold entries
commands/inbox.md           pause / resume / new-task / set-mode
```

## Operating it — common moves

**Add a task:** append `/new-task P0 <title> :: <details>` to
`commands/inbox.md`. The next wake picks it up.

**Pause / resume:** `/pause` or `/resume` in `commands/inbox.md`,
or `touch state/PAUSED` / `rm state/PAUSED`.

**Open the P5 pilot retry window** (current open work):

```bash
touch reports/PILOT_IN_PROGRESS    # overrides DONE.md + STOPSWITCH
rm   state/PAUSED                   # resume dispatch
# wait ~24h, then:
bash scripts/p5_grade.sh           # interactive merge judgment
rm   reports/PILOT_IN_PROGRESS     # re-engage gates
```

**Force a cycle now:** `bash scripts/autodev_continuous_cycle.sh`
(respects all gates — health, BLOCKED.md, DONE.md unless PILOT
sentinel present).

**Validate the harness:** `python3 -m pytest tests/` should be
100% green. The continuous-cycle script has 30 unit tests + 7 smoke
tests covering DONE / STOPSWITCH / BLOCKED / health / cooldown /
rate-limit / PILOT-override gating.

## The hold-on-blocker protocol (`§5`)

When you can't proceed on a task:

1. Write a `HOLD-<n>` entry to `reports/human-hold.md`.
2. Mirror to `tasks/blockers.md` and `reports/session-log.md`.
3. **Continue with the next safe task.** Don't halt the whole
   loop unless the blocker is critical (repo unreadable, git
   unusable, no write permission, CLI dead, missing secrets with
   no scaffold path).

## Known open thread

**P5 pilot retry** is in flight on
`CTlanston/auto-evo-playground` (10 pilot issues filed 2026-05-14,
fix in commit `fc3c0d8`). One known inner-engine bug remains:
`select_new_task` doesn't re-pick issues whose credit dropped to 65
after one failed review round. Expected pilot ceiling is ~6/10 until
that's fixed — flagged in `reports/p5-pilot-verdict.md`; requires
autodev-architect sign-off before any inner-engine edit per
`CLAUDE.md`.

## What this repo is NOT

- Not a chat assistant.
- Not a CI replacement (it drives shadow-branch CI, doesn't replace it).
- Not a code generator detached from feedback — every cycle is
  Planner → Coder → Reviewer → Guardian, all gated, all recording
  evidence to disk.
- Not push-to-`main`. Ever. See `CLAUDE.md`.

## Sibling project

The first real product target this AutoDev framework is iterating
on lives at
[`github.com/CTlanston/multi-agent-brainstorm`](https://github.com/CTlanston/multi-agent-brainstorm)
(Chrome extension that coordinates ChatGPT / Claude / Gemini for a
multi-round brainstorm). Its operating brief is
`/Users/lanston/Desktop/MCPs/muti-agent comm/AUTO_DEV_BRIEF.md` —
that's a separate autonomy loop with its own KPIs (K1–K10), 12-PR
backlog, and stop conditions. Use **this** project to evolve the
framework; use that project to apply it.
