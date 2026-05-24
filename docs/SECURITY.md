# Security

## Hard gates

| Gate | Default | Override |
|---|---|---|
| `system.allow_remote_writes` | `false` | edit `~/.claude-code-247/config.yaml` |
| `repo.auto_merge.enabled` | `false` per repo | onboarding wizard or edit `repos.yaml` |
| `forbidden_paths` | `.env`, `.env.*`, `secrets/**`, `.github/**`, `CLAUDE.md`, `AGENTS.md` | per-repo override allowed; non-empty list required |
| validator agreement | both PASS, no gaps | tunable via `validators.require_two_validators` |

## Forbidden-path enforcement

`orchestrator.path_guard.violations_in_diff()` is consulted by
`merge_policy.decide()` and by the dashboard PR detail page. Any
file matching the repo's `forbidden_paths` globs blocks the PR
*regardless of risk band*. Allowing an exception requires:

1. An operator decision logged in the `decisions` table, AND
2. A temporary override to the repo's `forbidden_paths` list.

## Secret scanning

`orchestrator.secret_scanner.scan(diff_text)` checks added lines for
common API key shapes (AWS, GitHub, Anthropic, OpenAI, Gemini, Slack,
PEM headers, generic `SECRET_*=value`). Hits show on the PR detail
page and (in M10+) block auto-merge.

This is a *guardrail*, not a substitute for proper secret scanning
(gitleaks, truffleHog). The orchestrator only ever pushes branches the
user explicitly opted into; secret-detection is the last fallback.

## Auth modes

| Mode | When | Fallback rule |
|---|---|---|
| `local_claude_code` (default) | normal operation | no key required; uses subscription |
| `anthropic_api_fallback` | explicit opt-in | requires `ANTHROPIC_API_KEY` AND either `auth.api_fallback_requires_approval: false` OR an approval token at the call site |
| `validator_api_only` | external judges run via API; main worker uses local | only validator paths see the key |

Switches between modes are logged and **never silent**.

## Audit

Every action that reaches the orchestrator is persisted:

- `commands` table — all CLI / dashboard / remote / scheduled inputs
- `task_events` — every state machine transition
- `runs` — every worker container invocation
- `notifications` — every ntfy + log emission
- `decisions` — every approval / rejection / override
- `incidents` — operator-tagged anomalies

The `claude247 logs` and dashboard `/logs` + `/commands` pages are the
read-side of the audit trail. They both go through the same SQLite
state, no parallel files.

## Emergency stop

```bash
claude247 stop-all
```

Enqueues a `stop_all` command. The orchestrator drains it by:
- halting the scheduler (no new tasks pulled)
- pausing all `queued` / `planning` / `coding` / `testing` / `reviewing`
  / `validating` tasks
- writing a `system_paused` notification
- recording a `stop_all` decision row
