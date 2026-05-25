# aedev Architecture

**Status:** Phase 0 — Design Foundation  
**Date:** 2026-05-25

> Note: This document covers the next-generation **aedev** TypeScript system.
> The previous Python system (claude-code-247 v1) is documented in
> `docs/ARCHITECTURE.md` (uppercase) and archived under `archive/auto-evo/`.

---

## System Identity

aedev is a local-first, multi-repo, 24/7 autonomous engineering OS. It runs as
a long-lived daemon process on the user's Mac, managed by macOS launchd. Task
workers execute inside Docker containers. GitHub is the audit and collaboration
surface, not the brain — scheduling, state management, and decision-making all
happen locally.

The design philosophy is: **own your compute, own your state**. Cloud services
(GitHub, Gemini, OpenAI) are used for specific capabilities (version control,
independent validation) but never as the primary control path. The system
continues working when network access is degraded; it only needs connectivity
for: pushing branches, posting PR comments, and calling external validators.

---

## Five Planes

```
Plane                   Technology                 Role
─────────────────────────────────────────────────────────────────────
Worker execution        Docker containers          Run Claude Code CLI per task
Human control           aedev CLI + dashboard      Approve, inspect, intervene
Collaboration/audit     GitHub (PRs, checks)       Persistent audit trail
Observability           Fastify daemon + REST/SSE  System status, task progress
State                   SQLite + evidence bundles  Ground truth for all decisions
```

### Worker Execution Plane

Each task gets its own Docker container. The container receives:
- A mounted git worktree for the target repository
- A mounted output directory for evidence writing
- Explicitly granted secrets only (no ambient environment variable injection)
- The Claude Code CLI binary (via the image)

Workers are ephemeral. The container is created at task start and destroyed (or
archived for replay) at task completion or failure. Workers communicate results
back to the daemon exclusively through the mounted output directory — they do
not call back over a socket or API.

### Human Control Plane

The `aedev` CLI provides the primary operator interface. It talks to the local
daemon via its REST API (localhost only). The web dashboard provides a richer
read-heavy view (roadmap, task timeline, approvals queue, risk board, ADR
browser) and is served by the same Fastify daemon.

The human control plane is not in the critical path for task execution — tasks
run, evidence is gathered, and results are written to SQLite regardless of
whether the operator is watching. The control plane is for inspection and
intervention.

### Collaboration/Audit Plane

GitHub receives:
- Branch pushes (one branch per task, based on mission slug and task ID)
- Pull request creation with structured body text
- Check status updates (pending → running → success/failure)
- Evidence summary comments (human-readable digest of the evidence bundle)
- Issue imports (issues can be pulled in and translated to missions)

GitHub does not: drive scheduling, hold authoritative state, trigger worker
execution, or make merge decisions. All of those happen locally. The GitHub
state is eventually consistent with SQLite state; if they diverge, SQLite wins.

### Observability Plane

The Fastify daemon exposes:
- `GET /api/status` — system overview, daemon health, active task count
- `GET /api/tasks` — task list with state and risk scores
- `GET /api/tasks/:id` — task detail including evidence bundle summary
- `GET /api/missions` — mission list
- `GET /api/approvals` — pending approval queue
- `GET /events` — Server-Sent Events stream for real-time updates
- `GET /` — dashboard SPA

The SSE stream is what the dashboard uses for live updates. CLI commands poll
the REST API directly.

### State Plane

SQLite (via `better-sqlite3`) is the authoritative state store. It holds all
tasks, missions, roadmaps, runs, approvals, risk scores, validator results,
model usage accounting, memory items, and secret grants.

Alongside SQLite, each task produces a filesystem evidence bundle at
`~/.aedev/evidence/<task_id>/`. The bundle is flat-file (markdown + JSON) and
is the artifact that validators receive. It is also the human-readable audit
trail — a new engineer can understand exactly what happened on a task by
reading the bundle.

---

## Module Map

```
packages/core        shared types, IDs (ULID), logging, config loader
packages/cli         aedev CLI (commander); talks to daemon REST API
packages/daemon      Fastify daemon, task scheduler, state machine,
                     repo registry, command queue, merge/risk policy,
                     memory injector, notification client, log indexer
packages/runner      Docker sandbox manager, git worktree manager,
                     Claude Code adapter, evidence bundle writer,
                     retry/replay controller
packages/github      Octokit wrapper, PR lifecycle, check status sync,
                     evidence comment writer, issue importer
packages/validators  Gemini judge adapter, OpenAI judge adapter,
                     validation policy (pass/fail/disagree logic)
packages/secrets     Secret grant manager (TTL-based, audit trail,
                     Docker env injection, revocation)
apps/dashboard       Vite + React local web dashboard (read-heavy,
                     SSE-driven live updates)
```

All packages are in a pnpm workspace. Packages depend on `packages/core` for
shared types. The CLI only imports `packages/core` types and makes HTTP calls —
it does not import daemon internals. The daemon imports runner, github,
validators, and secrets as libraries.

---

## Runtime State Layout

All runtime state lives under `~/.aedev/`:

```
~/.aedev/
  state.db              SQLite database (authoritative state)
  state.db-wal          SQLite WAL file (auto-managed)
  repos.yaml            Repo registry (canonical list of managed repos)
  config.yaml           System configuration (auth_mode, allow_remote_writes, …)
  adr/                  Architecture Decision Records (markdown)
  prd/                  Product Requirements Documents per mission
  roadmaps/             Roadmap files per mission
  missions/             Mission contract files
  evidence/
    <task_id>/          Per-task evidence bundle
      mission-contract.md
      task-plan.md
      transcript-summary.md
      changed-files.md
      test-summary.md
      validator-gemini.json
      validator-openai.json
      risk-report.json
      done-report.md
  memory/
    <repo_slug>/        Per-repo compiled memory
      decisions.md
      failures.md
      preferences.md
      conventions.md
  logs/
    daemon.jsonl        Structured daemon log (append-only)
    holds.md            Active HOLD entries (human-readable)
    <task_id>.jsonl     Per-task worker log
```

The `repos.yaml` file is edited via `aedev repo add/remove/edit` — it should
not be hand-edited because the daemon caches it in memory and must be notified
on change.

---

## Data Model

The SQLite schema defines these tables:

| Table | Purpose |
|---|---|
| `repos` | Registry of managed repositories (url, local_path, enabled, forbidden_paths) |
| `roadmaps` | Roadmap records linked to a repo; contain phase/milestone structure |
| `missions` | High-level units of work (PRD approved, roadmap approved, running) |
| `tasks` | Atomic units of implementation within a mission |
| `runs` | Individual Docker worker executions for a task (tasks can have multiple runs on retry) |
| `approvals` | Human approval requests and decisions (pending/approved/rejected) |
| `risk_scores` | Risk score records per run (0–100 integer, per-factor breakdown) |
| `validator_results` | Gemini and OpenAI validator output per run (pass/fail/error, reasoning) |
| `model_usage` | Per-run usage accounting (tokens, model name, subscription vs API mode) |
| `memory_items` | Per-repo compiled memory entries (decisions, failures, preferences, conventions) |
| `secret_grants` | Time-limited secret grants (task_id, secret_name, TTL, granted_by, expires_at) |
| `events` | Append-only event log (used for replay and SSE fan-out) |

All tables use ULID primary keys (26-character, sortable, URL-safe). Foreign
keys are enforced (`PRAGMA foreign_keys = ON`). All timestamps are ISO-8601
UTC strings.

---

## Agent Roles

### Lead Agent

Runs during the Intake phase. Receives a raw requirement string and produces:
- Clarifying questions (if ambiguous), answered interactively
- A Product Requirements Document (PRD)
- An Architecture Decision Record for any new architectural choices
- A phased roadmap breaking the PRD into missions and tasks

The Lead agent runs as a Claude Code CLI subprocess but does not write code.
Its output is written to `~/.aedev/prd/` and `~/.aedev/adr/` as markdown
files, then imported into SQLite.

### Builder Agent

The primary worker. Runs inside Docker for each task. Receives: repo worktree,
task plan, memory context (injected from `memory_items`), and any granted
secrets. Produces: code changes in the worktree, and writes the evidence bundle
to the output directory. Does not push to GitHub — that is done by the daemon
after evidence collection.

### Reviewer Agent

Runs after the Builder agent finishes. Receives: the task plan, the diff, and
the evidence bundle. Produces an assessment of whether the implementation
matches the acceptance criteria. The Reviewer does not have access to the
Builder's conversation transcript — only the plan and evidence.

### Validator Agents (Gemini, OpenAI)

External model validators. Receive only the evidence bundle (plan, diff
summary, test results, completion report). Never see the worker conversation
context, hidden chain-of-thought, or system prompts. Produce a structured
pass/fail verdict with reasoning. Both must pass for auto-advance on low-risk
tasks; disagreement triggers human approval.

---

## Evidence Bundle

Each task produces an evidence bundle written by the Builder worker and
supplemented by the daemon's post-processing:

| File | Written by | Contents |
|---|---|---|
| `mission-contract.md` | Daemon | The mission PRD excerpt and success criteria |
| `task-plan.md` | Daemon | The task plan (acceptance criteria, scope, approach) |
| `transcript-summary.md` | Builder | A structured summary of actions taken; no raw transcript |
| `changed-files.md` | Daemon | List of changed files with line counts and change type |
| `test-summary.md` | Builder | Test command, exit code, pass/fail counts, failure messages |
| `validator-gemini.json` | Validator | Structured verdict from Gemini |
| `validator-openai.json` | Validator | Structured verdict from OpenAI |
| `risk-report.json` | Daemon | Risk score (0–100) with per-factor breakdown |
| `done-report.md` | Builder | Final completion report: what was done, what was skipped, known gaps |

---

## Key Invariants

1. **No ambient secrets.** Docker containers receive no secret environment
   variables by default. Every secret access requires an explicit
   `secret_grant` record.

2. **Secret grants are TTL-bounded and audited.** Grants expire at
   `min(expires_at, task_completion)`. Expired grants are revoked immediately.

3. **SQLite is the source of truth.** GitHub state (PR status, check status)
   is a mirror. Divergence is resolved in favor of SQLite.

4. **Validators see only evidence.** Validator agents receive the evidence
   bundle, not the worker's conversation context or any internal
   chain-of-thought.

5. **Approval is required for:** medium-risk merges (score 30–59), high-risk
   merges (score 60–100), all secret grants, validator disagreement, dependency
   additions, workflow file changes, security-sensitive changes, and system
   config changes.

6. **`allow_remote_writes` defaults to `false`.** No `git push`, PR merge, or
   GitHub write API call executes unless this flag is `true` AND the target
   repo is `enabled: true` in `repos.yaml`.

7. **Forbidden paths are always enforced.** `.env*`, `secrets/**`,
   `.github/**`, `CLAUDE.md`, `AGENTS.md`, `.github/CODEOWNERS` cannot be
   modified by any worker without an explicit owner override.

8. **No silent API fallback.** Switching from local Claude Code CLI to the
   paid Anthropic API requires an explicit `auth_mode` config flag or operator
   approval. The switch is always logged and triggers a notification.

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript strict, Node.js 20+ (target 24 LTS) | Type safety in state machine; dashboard shares types with backend |
| Package manager | pnpm workspaces | Monorepo; fast install; strict hoisting |
| Daemon API | Fastify | Fast, low-overhead, native SSE support |
| Dashboard | Vite + React | Modern SPA tooling; shares types from `packages/core` |
| State | better-sqlite3 | Synchronous, embedded, zero-dependency server, portable |
| CLI | commander | Mature, well-typed, minimal |
| Testing | Vitest | Fast, TypeScript-native, workspace-aware |
| Linting | ESLint 9 + typescript-eslint + Prettier | Strict, consistent, automated |
| Workers | Docker + Claude Code CLI | Isolation, reproducibility, secret containment |
| GitHub | Octokit | Official, typed, maintained by GitHub |
| Service management | macOS launchd (Phase 3+) | Keeps daemon alive across reboots and Mac sleep/wake |
