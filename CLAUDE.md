# CLAUDE.md — repository-level guidance for `claude-code-247`

> **v4 banner — Simple Cowork · TS-only · event-first.**
> `WORKBOOK_v4.md` is the current source of truth (v3 / P0–P7 is complete and
> superseded). The product is a conversational coding cockpit evolving into a
> 24/7 standby team: Claude Code clarifies, plans and reviews through the
> local subscription CLI, Codex implements through the local subscription CLI,
> and Gemini validates from evidence only. Every session must read
> [WORKBOOK_v4.md §0](WORKBOOK_v4.md) before any write.

> This file is auto-loaded by Claude Code when it operates inside this repo.
> It is **not** an instruction from a user; treat it as repository policy.

## What this repo is

`claude-code-247` is a local-first, multi-repo, 24/7 autonomous coding
coworker. The Mac stays on; a TypeScript daemon coordinates operator
missions, repo-bound worker runs, evidence capture, validation, and a
Vite/React dashboard for the conversational cockpit.

```
Claude CLI             clarification and planning plane
Codex CLI              implementation plane
Gemini validator       evidence-only review plane
GitHub                 optional PR collaboration plane
React dashboard        operator cockpit plane
SQLite events/state    source-of-truth state plane
```

The previous Auto-Evo + AutoDev v3 implementation lives under
`archive/auto-evo/` for reference. Do not import from there.

## Module map

```
packages/core/          SQLite schema, events, ids, repo registry, state machine
packages/daemon/        daemon, Fastify routes, mission lifecycle, PR gate,
                         operator cockpit backend, memory helpers, validators
packages/runner/        local CLI adapters, Docker runner, repo-bound worktrees,
                         evidence writer, worker session discovery
packages/validators/    Gemini/OpenAI evidence-only validators and merge policy
packages/github/        GitHub client and PR/check helpers
packages/cli/           `aedev` command surface
packages/qa/            browser QA utilities
apps/dashboard/         React/Vite operator cockpit
scripts/                dev startup, smoke/e2e runners, launchd helpers
docs/                   architecture, operations, handoff, parked-package notes
archive/auto-evo/       legacy reference only; do not import from it
```

Runtime state lives under `~/.aedev/` by default, or under `AEDEV_HOME` when
that environment variable is set:

```
~/.aedev/
  state.db                 SQLite state and event store
  state/                   cockpit evidence, PRD artifacts, worktrees, holds
  config.yaml              system config, including allow_remote_writes
  operator-prefs.md        global operator memory (future Tier 1)
  logs/                    daemon/operator logs when configured
```

## Non-negotiables

1. **Never edit `.env`**, `secrets/**`, SSH keys, keychain, or production
   credentials in any repo this system manages.
2. **`system.allow_remote_writes` is the safety gate.** Default is `false`.
   No `git push`, no PR merge, no GitHub write API call may execute unless
   this flag is `true` AND the repo is `enabled: true` in `repos.yaml`.
3. **Forbidden paths are enforced.** Per repo, `forbidden_paths` always
   includes `.env*`, `secrets/**`, `.github/**`, `CLAUDE.md`, `AGENTS.md`
   unless the owner explicitly overrides.
4. **Validators run on evidence only.** They never see Coder conversation
   context or hidden chain-of-thought.
5. **Approval is required for medium-risk merges, all high-risk merges,
   API fallback, budget override, forbidden-path exception, dependency
   addition, workflow change, security change, and system config change.**
6. **No silent API fallback.** Switching from local Claude Code to the
   paid Anthropic API requires an explicit config flag or operator
   approval; the system logs the switch and notifies.

## Cost modes / auth modes

Default: `auth_mode: local_claude_code` for planning and
`auth_mode: local_codex` for coding — use the user's locally authenticated
subscription CLI sessions.

Fallback: `auth_mode: anthropic_api_fallback` — paid API. Only used when
the config or operator explicitly allows it.

Validator-only: `auth_mode: validator_api_only` — main worker stays on
local CLI; external validators (Gemini, OpenAI) use their own keys.

The system never exports usage of `local_claude_code` as "$0 cost". It
reports it as `subscription_mode_usage: tracked by run count, exact cost
unknown`.

## Hold-on-blocker protocol

When a single task can't make progress: write a `HOLD-<n>` entry in the
state DB and `~/.aedev/logs/holds.md`, notify (ntfy), and
continue with the next task. Halt the whole loop only for critical
blockers: repo unreadable, git unusable, no write permission, claude CLI
dead, missing secrets with no scaffold path, docker daemon down with no
fallback.

## Where to read state

CLI:
```
claude247 status            system + active tasks + holds + pending approvals
claude247 repos             registry view
claude247 tasks             active + recent task list
claude247 logs tail         live logs
```

Files (do not edit directly unless a phase explicitly requires it):
```
~/.aedev/state.db
~/.aedev/state/**
~/.aedev/logs/**
```

## Working with the legacy system

Old code is under `archive/auto-evo/`. It is preserved for reference and
for one-off cycle replays. Do not import from `archive/`. Do not extend
the legacy schema. The new system writes nothing into `archive/`.
