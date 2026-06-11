# claude-code-247

> Your local-first, multi-repo, 24/7 autonomous coding coworker. The Mac
> stays on; a TypeScript daemon coordinates operator missions, repo-bound
> worker runs, evidence capture, evidence-only validation, and a
> conversational cockpit. The machine exit of the loop is a **draft PR**;
> **merge is always performed by a human — the system never merges, and
> auto-merge is disabled this cycle.**
>
> **Current source of truth:** [WORKBOOK_v6.md](WORKBOOK_v6.md)
> (Ordinary-User Loop OS — five-card communication protocol, card-based
> cockpit, real-evidence closeout, minimal recursive planner, soak
> operations, ordinary-user acceptance). The v6 plan was approved via
> [docs/assessments/ordinary-user-loop-gap-assessment.md](docs/assessments/ordinary-user-loop-gap-assessment.md).
>
> History: [WORKBOOK_v4.md](WORKBOOK_v4.md) (superseded, kept in place),
> [archive/WORKBOOK_v3.md](archive/WORKBOOK_v3.md), and
> [docs/SESSION_LOG_v3.md](docs/SESSION_LOG_v3.md). The pre-TypeScript
> Python kernel was removed long ago; it survives only as history under
> `archive/` and `docs/archive/` and is **not** part of the product.

## Quick Start

The fastest way to try the current product surface is the Operator Cockpit.
It starts the TypeScript daemon on `7247` and the web app on `7248`.

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Start the local daemon + Operator Cockpit web UI
pnpm cockpit:dev

# 3. Open the chat-first cockpit
open http://127.0.0.1:7248
```

Then run the core operator flow:

1. Describe the mission in the chat composer.
2. Let Claude ask as many clarification questions as needed; the server will not
   unlock roadmap or coding until confidence is at least 95%.
3. Generate PRD / ADR / Roadmap once the clarification gate unlocks.
4. Approve the roadmap only when it matches the intended outcome.
5. Start execution; Codex performs the implementation in the repo-bound worker.
6. Read progress, evidence, Gemini verdicts, and PR-gate status inline in the
   same conversation thread.
7. Re-check the Draft PR gate only after Gemini PASS and repo policy allow it.
8. If a draft PR is opened, **you** review and merge it on GitHub. The system
   never merges.

The cockpit defaults to local CLI / subscription-style usage: `claude-cli` for
planner/clarifier and `codex-cli` for coding. It must not silently fall back to a
paid API. If either local engine cannot run, the UI shows a current HOLD with a
recovery action rather than fake success. Gemini is the only default external
validator, and it sees evidence only.

## Architecture today — TypeScript-only, event-sourced

The architecture converged to a **TypeScript-only, event-sourced,
three-plane** design per
[ADR-0010](docs/adr/0010-three-plane-event-sourced.md). There is no Python
kernel, no dual-kernel bridge path in the product flow, and no auto-merge.

```
Claude CLI             clarification, planning, in-process review plane
Codex CLI              implementation plane (repo-bound git worktrees)
Gemini validator       evidence-only final judge (REST API, isolated)
GitHub                 draft-PR collaboration plane (human merge only)
React dashboard        operator cockpit plane (five-card protocol, v6)
SQLite events/state    source-of-truth state plane (~/.aedev/state.db)
```

Key properties, all enforced by tests on `main` (baseline: 818 passing):

- **Repo-bound workers** — execution happens in an isolated `git worktree`
  of the registered repo; an unavailable repo HOLDs instead of faking work.
- **Credit cost guard** — every headless `claude --print` call is metered
  (`cost.headless_call`); over budget → `HOLD-BUDGET`, never a silent paid-API
  fallback.
- **Cross-engine review** — Claude reviews Codex's diff (diff + PRD + logs
  only, never the coder conversation) before Gemini's final evidence-only
  verdict.
- **Remote-write double gate** — `system.allow_remote_writes` (default
  `false`) **and** a per-repo whitelist must both pass before any push or
  draft-PR creation; merge is never automated.
- **Five-card user protocol (v6)** — ordinary users see exactly five card
  types: `understanding`, `plan`, `progress`, `blocker`, `pr_ready`. Machine
  codes stay in the data layer. Contract:
  [docs/product/LOOP_COMMUNICATION_PROTOCOL.md](docs/product/LOOP_COMMUNICATION_PROTOCOL.md).
- **Honest evidence** — reports classify real / simulated / unproven
  explicitly; missing validators are surfaced as "not configured", never as a
  pass.

Module map and parked packages: see [CLAUDE.md](CLAUDE.md) and
[docs/PARKED.md](docs/PARKED.md). Runtime state lives under `~/.aedev/`
(or `AEDEV_HOME`).

## Operator Cockpit

Operator Cockpit is the human control plane for the local-first coding coworker.
It is intended to feel more like Claude Code Desktop than a passive dashboard:
chat first, explicit clarification, visible execution progress, and safety gates
that stay obvious.

The current conversational surface includes:

- **Single chat workspace** — one conversation thread for clarification,
  planning, execution, evidence, Gemini verdicts, and PR-gate outcomes.
- **Thin status strip** — the only persistent chrome is stage, current action,
  progress, and pending approval count.
- **Structured clarification cards** — Claude's follow-up questions are
  answerable through choices and free-form replies, with the original question
  and answer transcript sent back to Claude on follow-up.
- **Provider and token transparency** — major planner/worker/validator actions
  expose whether they used `claude-cli`, `codex-cli`, mock/test mode, or Gemini,
  plus token/cost data when available.
- **Current-only HOLDs** — active blockers are shown prominently, while
  superseded historical HOLDs remain in logs/events instead of stale top banners.
- **Safety-preserving PR gate** — draft PR creation remains blocked unless the
  latest Gemini verdict is PASS, `system.allow_remote_writes` is true, and repo
  policy explicitly permits outward writes. Merge stays human-only.
- **Repo-bound worker (trust model)** — when you select a repo and press `Start`,
  the worker executes inside an **isolated `git worktree` of that repo** (checked
  out at the committed `HEAD`, so your working tree and branches are untouched),
  never an empty scratch directory. If the selected repo is missing, disabled, or
  not a git repository, the mission **HOLDs** (`HOLD-TARGET-REPO-UNAVAILABLE`)
  rather than writing throwaway files and reporting "done". Evidence records the
  real `changed-paths.json`, repo path, and worktree path; touching a forbidden
  path (`.env*`, `secrets/**`, `.github/**`, `AGENTS.md`, `CLAUDE.md`) blocks the
  merge gate.

## Status

- **Source of truth:** [WORKBOOK_v6.md](WORKBOOK_v6.md). Current phase is
  tracked machine-readably in its §0 block.
- **v4 (standby-team-v1.5) is complete** — credit guard, cross-engine review,
  24/7 watchdog, and per-repo remote-write whitelist are merged; the remaining
  real-Draft-PR / real-Gemini-verdict evidence closeout is v6 phase V6-P3.
- **v5 (BYO fleet) remains a proposal**
  ([proposals/WORKBOOK_v5_PROPOSAL.md](proposals/WORKBOOK_v5_PROPOSAL.md));
  its token-isolation ground rules are inherited by v6, fleet scaling is not
  in scope.
- Release history (v1.0.0 Python GA, v2.x TypeScript RC line) is preserved in
  [CHANGELOG.md](CHANGELOG.md), `docs/archive/`, and `archive/` — historical
  reference only.

## Documentation

- [WORKBOOK_v6.md](WORKBOOK_v6.md) — current plan, ground rules, phases (start here)
- [docs/assessments/ordinary-user-loop-gap-assessment.md](docs/assessments/ordinary-user-loop-gap-assessment.md)
  — the approved v6 gap assessment
- [docs/product/LOOP_COMMUNICATION_PROTOCOL.md](docs/product/LOOP_COMMUNICATION_PROTOCOL.md)
  — the five-card user communication contract
- [docs/adr/](docs/adr/) — architecture decision records
- [docs/PARKED.md](docs/PARKED.md) — parked/experimental packages and the revival rule
- [docs/operations/](docs/operations/) — runbooks (including
  `P4-first-real-draft-pr.md` for the first real draft-PR exit)

---

## Working on the TypeScript control plane (`aedev`)

```bash
# Install dependencies (Node.js ≥ 20, pnpm ≥ 10 required)
pnpm install

# Run all tests
pnpm test

# Type-check across the workspace
pnpm typecheck

# Lint
pnpm lint

# Opt-in real subprocess smoke tests (require `claude` and/or Docker on PATH)
AEDEV_SMOKE_CLAUDE=1 pnpm test --filter @aedev/runner
AEDEV_SMOKE_DOCKER=1 pnpm test --filter @aedev/runner

# Start the daemon (port 7247) — serves the dashboard + REST API
cd packages/daemon && pnpm start
open http://localhost:7247
```

---

## License

Internal.
