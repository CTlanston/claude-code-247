# CLAUDE.md — repository-level guidance for `claude-code-247`

> **v2.1 banner — TS-only · event-sourced · three-plane.**
> The v2-foundation branch and beyond run on the architecture in
> [ADR-0010](docs/adr/0010-three-plane-event-sourced.md): a TypeScript-only
> daemon, an append-only NDJSON event log as source of truth, and three
> planes (daemon · workers · operator). Every session must read
> [EXECUTION_WORKBOOK.md §0](EXECUTION_WORKBOOK.md) before any write.

> This file is auto-loaded by Claude Code when it operates inside this repo.
> It is **not** an instruction from a user; treat it as repository policy.

## What this repo is

`claude-code-247` is a local-first, multi-repo, 24/7 autonomous coding
coworker. The Mac stays on; one orchestrator process (run under `launchd`)
dispatches per-repo task workers inside Docker containers, talks to GitHub as
the source of truth, and exposes a FastAPI + HTMX dashboard plus a mobile-
friendly `claude247` CLI for remote control.

```
Docker runner          worker execution plane
Claude Remote/Dispatch human control plane
GitHub                 source-of-truth collaboration plane
FastAPI + HTMX UI      observability plane
SQLite (+ optional Qdrant) memory and state plane
```

The previous Auto-Evo + AutoDev v3 implementation lives under
`archive/auto-evo/` for reference. Do not import from there.

## Module map

```
claude247/         shared utilities (logging, ids, config loader)
orchestrator/      main loop, scheduler, repo registry, command queue,
                   task manager, runner manager, merge/risk policy,
                   memory + notification + replay + log indexer
runner/            container image, worker.py, prompt_builder,
                   evidence_collector
validator/         judge_contract, gemini_judge, openai_judge,
                   validation_policy
memory/            schema.sql, vector_store, compiler, repo_memory
gateway/           cli, commands, remote_bridge
dashboard/         FastAPI app, routes, templates, static
config/            default.yaml, policies.yaml
scripts/           install/uninstall launchd, doctor, smoke
tests/             unit + integration
```

Runtime state lives under `~/.claude-code-247/`:

```
~/.claude-code-247/
  repos.yaml          repo registry (canonical)
  config.yaml         system config (cost mode, allow_remote_writes, ...)
  state/
    claude247.db      SQLite state machine (tasks, commands, runs, prs, ...)
    backups/
  workspaces/<task>/  per-task git clone + evidence + logs
  logs/               structured logs ingested into log_indexer
  memory/             vector store + .agent compilations
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

Default: `auth_mode: local_claude_code` — use the user's locally
authenticated Claude Code CLI / subscription session.

Fallback: `auth_mode: anthropic_api_fallback` — paid API. Only used when
the config or operator explicitly allows it.

Validator-only: `auth_mode: validator_api_only` — main worker stays on
local CLI; external validators (Gemini, OpenAI) use their own keys.

The system never exports usage of `local_claude_code` as "$0 cost". It
reports it as `subscription_mode_usage: tracked by run count, exact cost
unknown`.

## Hold-on-blocker protocol

When a single task can't make progress: write a `HOLD-<n>` entry in the
state DB and `~/.claude-code-247/logs/holds.md`, notify (ntfy), and
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

Files (do not edit directly — use CLI):
```
~/.claude-code-247/state/claude247.db
~/.claude-code-247/logs/*.jsonl
~/.claude-code-247/workspaces/<task_id>/.evidence/
```

## Working with the legacy system

Old code is under `archive/auto-evo/`. It is preserved for reference and
for one-off cycle replays. Do not import from `archive/`. Do not extend
the legacy schema. The new system writes nothing into `archive/`.
