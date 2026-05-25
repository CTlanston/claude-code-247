# aedev Operating Model

**Status:** Phase 0 — Design Foundation  
**Date:** 2026-05-25

This document describes how aedev operates day-to-day: lifecycle states,
human intervention points, hold protocol, cost accounting, and the CLI
command reference.

---

## Mission Lifecycle

A mission is a high-level unit of work corresponding to an approved PRD and
roadmap. Missions proceed through the following states:

```
draft
  |
  |  (Lead agent generates PRD)
  v
pending_approval
  |
  |  (operator: aedev mission approve <id>)
  |  (approval recorded in approvals table)
  v
approved
  |
  |  (Lead agent generates roadmap; operator: aedev mission roadmap-approve <id>)
  |  (tasks are created from roadmap; workers may begin)
  v
running
  |
  |-- (all tasks done) ---------> done
  |-- (operator cancels)  ------> cancelled
  |-- (unrecoverable failure) --> failed
  `-- (operator pauses) --------> paused
                                    |
                                    `-- (operator resumes) --> running
```

A mission can only move to `running` after both PRD approval and roadmap
approval. Tasks within the mission are created at roadmap-approval time and
run concurrently up to the configured `max_concurrent_tasks` limit.

A `paused` mission stops dispatching new tasks. Tasks already running are
allowed to complete (or fail) before the mission fully pauses.

A `failed` mission means a blocking failure occurred that cannot be retried
automatically. The operator must investigate, optionally fix the underlying
issue, and either restart the mission or cancel it.

---

## Task Lifecycle

A task is an atomic unit of implementation within a mission. One task maps to
one Docker worker run (though a task may have multiple runs on retry).

```
pending
  |
  |  (scheduler picks up task; worker container starts)
  v
running
  |
  |-- (worker exits 0, evidence complete, validators pass) --> done
  |-- (worker exits non-zero, retries exhausted) -----------> failed
  |-- (operator cancels) -----------------------------------> cancelled
  `-- (can't make progress; HOLD written) ------------------> hold
```

A task in `hold` state is paused. The daemon continues dispatching other tasks.
The hold entry explains what was tried, why progress stopped, and what the
operator needs to do. Once the operator resolves the blocker, the task is
retried via `aedev task retry <task_id>`.

Tasks in `done` state may still require human approval before the PR is merged,
depending on the risk score and merge policy (see `docs/security-model.md`).

---

## Human Gates

Certain events always require explicit human approval before the system
proceeds. Approval is recorded in the `approvals` table with: who approved,
when, and any notes.

| Gate | When it fires | What blocks until approved |
|---|---|---|
| PRD approval | After Lead agent generates the PRD | Roadmap generation does not start |
| Roadmap approval | After Lead agent generates the roadmap | No tasks are created; no workers run |
| Secret grant | Operator requests a temporary secret for a task | Worker for that task does not start |
| Validator disagreement | Gemini and OpenAI disagree on verdict | PR is not merged |
| Medium risk | Risk score 30–59 | PR merge is blocked until approved |
| High risk | Risk score 60–100 | PR merge is blocked; remediation required |
| Dependency addition | Worker added a new package dependency | PR merge gated |
| Workflow change | Worker modified `.github/workflows/` | PR merge gated |
| Security change | Risk scorer flags a security-sensitive change | PR merge gated |
| System config change | `config.yaml` or `policies.yaml` modified | Change applied only after approval |

The approvals queue is visible at `aedev status` and in the dashboard
Approvals view. Unresolved approvals do not block the rest of the system —
other tasks continue to run.

---

## Hold-On-Blocker Protocol

When a single task cannot make progress, the system:

1. Writes a `HOLD` entry to the `tasks` table (state: `hold`)
2. Appends a HOLD record to `~/.aedev/logs/holds.md` with:
   - `task_id`
   - `mission_id`
   - `severity` (warning / error / critical)
   - `category` (e.g., `missing_credential`, `test_infrastructure`, `external_api`)
   - `what_tried` — list of approaches attempted
   - `why_stopped` — exact reason progress is impossible
   - `exact_action_needed` — what the operator must do to unblock
   - `workaround` — whether the task can be skipped and the mission continued
3. Sends a notification via ntfy
4. Continues dispatching other pending tasks (the hold does not pause the
   mission or the system)

### Critical Blockers (Halt the Whole Loop)

The system halts task dispatch entirely (but keeps the daemon running and
the API responsive) only for these critical conditions:

- Target repository is unreadable or missing
- `git` binary is not available or exits non-zero on a read operation
- No write permission to the worktree directory
- Claude CLI is not authenticated or crashes on every invocation
- Required secrets are missing with no scaffold path
- Docker daemon is not running and no local fallback is configured

For critical blockers, the daemon writes a `critical_hold` event to the
`events` table, notifies via ntfy with `priority: high`, and logs to
`~/.aedev/logs/daemon.jsonl`.

---

## Cost Modes

aedev tracks model usage explicitly. The cost mode determines how the primary
worker and validators authenticate to AI services.

### `auth_mode: local_claude_code` (default)

Workers use the user's locally authenticated Claude Code CLI session. This
reuses the user's existing Claude subscription. Costs are not zero — they draw
on the subscription — but they are not billed per-token as API calls.

Usage is reported as: `subscription_mode_usage: tracked by run count, exact
cost unknown`. The system never reports this as "$0" because subscription costs
are real; they are simply not enumerable per-call.

### `auth_mode: anthropic_api_fallback`

Workers use the Anthropic REST API with an API key from `secrets/**`. This is
billed per-token. This mode is never activated automatically. It requires
either:
- `auth_mode: anthropic_api_fallback` explicitly set in `config.yaml`, or
- Operator approval via `aedev config set auth_mode anthropic_api_fallback`
  (which triggers an approval gate)

Switching to this mode is always logged to `daemon.jsonl` and triggers a
notification.

### `auth_mode: validator_api_only`

Workers use the local Claude Code CLI (same as default mode). Only external
validators (Gemini, OpenAI) use their API keys. This is the recommended
production mode when you want independent validation without switching the
primary worker to API billing.

### No Silent API Fallback

If the local Claude CLI fails (authentication expired, network issue, process
crash), the system does not silently fall back to the Anthropic API. Instead,
it marks the run as `failed` with reason `claude_cli_unavailable`, writes a
HOLD entry, and notifies the operator. The operator can then either fix the
CLI auth or explicitly enable API fallback.

---

## CLI Command Reference

All CLI commands communicate with the local daemon over its REST API. If the
daemon is not running, commands that require state will print an error and exit
non-zero.

### System

```
aedev status
```
Prints: daemon running/stopped, active task count, hold count, pending
approval count, system auth mode, `allow_remote_writes` status.

```
aedev daemon start [--port <n>] [--foreground]
aedev daemon stop
aedev daemon restart
aedev daemon status [--plain]
```
Manage the local Fastify daemon. `--foreground` keeps the process attached
to the terminal (useful for debugging). `--plain` emits machine-parseable
output (no color, no spinner).

```
aedev doctor
```
Checks: Docker daemon running, Claude CLI authenticated, GitHub auth valid
(`gh auth status`), SQLite writable, launchd plist loaded, disk space above
threshold.

```
aedev dashboard
```
Opens the local dashboard at `http://localhost:<port>/` in the default browser.

### Repository Registry

```
aedev repo list
aedev repo add <name> --url <github_url> [--local-path <path>]
aedev repo remove <name> [--confirm]
aedev repo edit <name> --field <key>=<value>
```

### Missions

```
aedev mission list [--state <state>]
aedev mission view <id>
aedev mission approve <id> [--note "<text>"]
aedev mission roadmap-approve <id> [--note "<text>"]
aedev mission pause <id>
aedev mission resume <id>
aedev mission cancel <id> [--confirm]
```

### Tasks

```
aedev task list [--mission <id>] [--state <state>]
aedev task view <id>
aedev task retry <id>
aedev task replay <id>
aedev task approve <id> [--note "<text>"]    # approves WAITING PR merge
aedev task reject <id> [--reason "<text>"]  # rejects WAITING PR merge
```

### Intake

```
aedev intake "<raw requirement>"
```
Starts the intake flow: creates a mission in `draft` state, runs the Lead
agent for clarification and PRD generation, then awaits PRD approval.

### Memory

```
aedev memory list <repo>
aedev memory clear <repo> [--confirm]
```

### Secrets

```
aedev secret grant <task_id> <secret_name> --ttl <seconds> --reason "<text>"
aedev secret revoke <grant_id>
aedev secret list [--task <task_id>]
```

---

## Non-Negotiables

These constraints are enforced in code and cannot be overridden via config:

1. **Never edit `.env`, `secrets/**`, SSH keys, keychain, or production
   credentials** in any repo the system manages. These paths are in the
   default `forbidden_paths` for every repo.

2. **`system.allow_remote_writes` defaults to `false`.** No `git push`, no PR
   merge, no GitHub write API call executes unless:
   - `allow_remote_writes: true` is set in `config.yaml`, AND
   - The target repo has `enabled: true` in `repos.yaml`
   Both conditions must be true simultaneously.

3. **Forbidden paths are always enforced.** Every repo always has these
   forbidden paths regardless of other config: `.env*`, `secrets/**`,
   `.github/**`, `CLAUDE.md`, `AGENTS.md`, `.github/CODEOWNERS`. Exceptions
   require an explicit `forbidden_path_override` entry in `repos.yaml` signed
   with the repo owner's GitHub username.

4. **No silent API fallback.** Described above under Cost Modes.

5. **Approval records are immutable.** An approved decision cannot be
   un-approved. If a previously approved item needs to be re-evaluated, a new
   approval request is created.
