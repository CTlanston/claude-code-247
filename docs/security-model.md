# aedev Security Model

**Status:** Phase 0 — Design Foundation  
**Date:** 2026-05-25

This document describes the security design for aedev: how secrets are
isolated, how risk is scored, how merge decisions are made, and what
approvals are required. These constraints are non-negotiable and enforced
in code, not just policy.

---

## Secret Isolation Principle

Workers run in Docker containers with no default environment variable
injection. A fresh worker container starts with:
- The git worktree mounted read-write
- The evidence output directory mounted read-write
- Standard system environment variables (PATH, HOME, USER)
- No API keys, no tokens, no credentials of any kind

This means a worker cannot accidentally (or deliberately) exfiltrate secrets
by reading `$ANTHROPIC_API_KEY`, `$GITHUB_TOKEN`, or any other credential that
happens to be set in the host environment. The host environment is not
inherited by Docker containers in aedev's launch configuration.

---

## Secret Grant Model

Some tasks legitimately need credentials — for example, running integration
tests against a real external API. To grant a worker temporary secret access:

1. The operator runs: `aedev secret grant <task_id> <secret_name> --ttl <seconds> --reason "<text>"`
2. The daemon creates a `secret_grants` record:

```
secret_grant {
  id:           ULID
  task_id:      string          -- the specific task being granted access
  secret_name:  string          -- key name in the secrets store
  ttl_seconds:  integer         -- lifetime of the grant
  granted_by:   string          -- operator username or "system"
  granted_at:   ISO-8601 UTC    -- when the grant was created
  expires_at:   ISO-8601 UTC    -- granted_at + ttl_seconds
  reason:       string          -- why this task needs this secret
  revoked_at:   ISO-8601 UTC?   -- null until revoked
  used_at:      ISO-8601 UTC?   -- when the secret was first injected
}
```

3. When the runner launches the Docker container for that task, it reads the
   `secret_grants` table. If a valid (non-expired, non-revoked) grant exists,
   it reads the secret value from the local secrets store and injects it as an
   environment variable in that specific container only.

4. When the task completes or fails, the daemon immediately revokes all grants
   for that task by setting `revoked_at`. If the TTL expires before the task
   completes, the grant is also revoked — the worker will lose access to the
   secret at the next TTL check boundary (checked every 60 seconds).

5. All grant operations (create, use, revoke, expire) are written to the
   `events` table and `daemon.jsonl`.

### What the Secrets Store Is

In Phase 0, the secrets store is a reference to named entries in macOS
Keychain (accessed via the `security` CLI). Workers never touch Keychain
directly — the daemon reads the secret and injects the value into the
container environment. Workers see the value but not the name or location of
the source.

---

## Forbidden Paths

Every repository managed by aedev always has these forbidden paths, regardless
of any other configuration:

```
.env
.env.*
.env.*.*
secrets/**
.github/**
CLAUDE.md
AGENTS.md
.github/CODEOWNERS
```

A worker that attempts to read, modify, or create any file matching these
patterns will have its run immediately terminated. The run is marked `failed`
with reason `forbidden_path_touch`. The event is logged and the operator is
notified.

### Overriding Forbidden Paths

If a repository legitimately needs to allow modification of a normally
forbidden path (for example, a CI/CD repo that manages its own workflow files),
the repo owner can add a `forbidden_path_override` entry to `repos.yaml`:

```yaml
repos:
  - name: my-cicd-repo
    url: https://github.com/org/my-cicd-repo
    enabled: true
    forbidden_path_overrides:
      - path: ".github/workflows/deploy.yml"
        allowed_by: "ctlanston"
        reason: "this repo manages its own deploy workflow"
```

Overrides require the `allowed_by` field to be the GitHub username of the repo
owner. Adding an override is itself a system config change and requires
operator approval.

---

## Risk Scoring Model

Every task run is scored on a 0–100 integer scale based on what the worker
changed. The risk score drives the merge policy. Scores are additive — if a
change touches multiple risk factors, the scores stack (capped at 100).

| Factor | Score | Condition |
|---|---|---|
| Forbidden path touch | +50 | Any file matching forbidden path patterns (terminates run immediately; score is for audit only) |
| Large diff | +20 | Diff exceeds 500 lines changed (adds + deletions) |
| Dependency change | +15 | `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, or any lock file modified |
| Test coverage decrease | +15 | Coverage report shows net decrease from baseline |
| Secret usage | +20 | Risk scorer detects patterns matching secret references in code (not in test fixtures) |
| Database/migration change | +20 | Any file in `migrations/`, `db/`, or matching `*.sql` pattern |
| Control-plane change | +30 | Any file under `.github/workflows/` (only applicable if override is in place) |

### Score Calculation

The score is computed from the diff statistics and evidence bundle. It is not
based on AI assessment — it is a deterministic function of observable diff
properties. This makes it auditable and reproducible.

The `risk-report.json` in the evidence bundle contains:

```json
{
  "score": 42,
  "factors": [
    { "name": "large_diff", "points": 20, "detail": "812 lines changed" },
    { "name": "dependency_change", "points": 15, "detail": "package.json modified" },
    { "name": "test_coverage_decrease", "points": 15, "detail": "coverage: 84% → 79%" }
  ],
  "policy": "WAITING"
}
```

---

## Merge Policy

The merge policy is a direct function of the risk score and validator results.

| Condition | Policy | Effect |
|---|---|---|
| Score 0–29 AND both validators pass | `AUTO_MERGE` | Daemon pushes branch, creates PR, merges automatically (if `allow_remote_writes: true`) |
| Score 30–59 OR one validator passes with caveats | `WAITING` | PR is created; human approval required before merge |
| Score 60–100 OR either validator fails | `BLOCKED` | PR is created (for visibility) but marked blocked; merge is not possible until risk is remediated |
| Validator disagreement (one pass, one fail) | `WAITING` | Regardless of score; human must review |

### AUTO_MERGE Conditions

For a task to be auto-merged, all of the following must be true:
- Risk score is 0–29
- Both Gemini and OpenAI validators return `verdict: pass`
- No forbidden path was touched
- No dependency was added
- `allow_remote_writes: true` in `config.yaml`
- The repo is `enabled: true` in `repos.yaml`
- The repo has `auto_merge.enabled: true` in `repos.yaml` (opt-in per repo)

If any condition is false, the policy falls back to `WAITING`.

### Remediation for BLOCKED Tasks

A `BLOCKED` task cannot be merged until the risk factors are addressed. Options:
1. The operator reviews the task and decides the risk is acceptable, then
   explicitly overrides via `aedev task approve <id> --override-block --reason "<text>"`. This requires a second approval from a different operator if
   `require_dual_approval_for_block_override: true` is set.
2. The task is revised — the operator asks for a new run with the high-risk
   changes removed or reduced.
3. The task is cancelled and the mission roadmap is adjusted.

---

## Validator Isolation

External validators (Gemini, OpenAI) are called with only the evidence bundle.
They never receive:
- The worker's conversation transcript
- The Claude system prompt or role prompts
- Any internal chain-of-thought or reasoning traces
- The operator's original requirement string (they get the task plan instead)

This isolation is enforced structurally: the validator adapter function
signature accepts an `EvidenceBundle` type only. The daemon does not pass any
other data to the validator call path.

The evidence bundle contains: mission contract, task plan, transcript summary
(a structured summary written by the worker, not the raw conversation),
changed files list, test summary, and the done report. It does not contain the
full conversation log or any content from the worker's Claude context window.

---

## Approval Requirements

The following events always generate an `approval` record that must be resolved
before the associated action proceeds:

| Event | Category | Approval blocks |
|---|---|---|
| PRD review | `prd_review` | Roadmap generation and task creation |
| Roadmap review | `roadmap_review` | Task creation and worker dispatch |
| Secret grant | `secret_grant` | Container launch for the grantee task |
| Validator disagreement | `validator_disagreement` | PR merge |
| Medium risk merge | `medium_risk_merge` | PR merge |
| High risk merge (BLOCKED) | `high_risk_merge` | PR creation visibility only; merge requires block override |
| Dependency addition | `dependency_addition` | PR merge |
| Workflow change | `workflow_change` | PR merge |
| Security change | `security_change` | PR merge |
| System config change | `system_config_change` | Config applied to daemon |
| API fallback activation | `api_fallback` | Switching to paid API mode |

### Approval Records

```
approval {
  id:           ULID
  type:         ApprovalType     -- one of the categories above
  entity_id:    string           -- task_id, mission_id, grant_id, etc.
  state:        pending | approved | rejected
  requested_at: ISO-8601 UTC
  resolved_at:  ISO-8601 UTC?
  resolved_by:  string?          -- operator username
  note:         string?          -- operator note
}
```

Approval records are immutable once resolved. A `rejected` decision cannot
become `approved` — a new approval request must be created if the situation
changes. This provides a complete, unalterable audit trail.

---

## Threat Model

aedev's security model is designed to resist these threat scenarios:

**Runaway worker:** A worker that goes off-script and attempts to read or
modify sensitive files is stopped by the forbidden-path enforcement. Even if it
bypasses that check, it has no secrets to exfiltrate (secret isolation
principle). The container is destroyed after run completion.

**Prompt injection in the codebase:** A malicious string in the target
repository's source code that attempts to hijack the Claude worker. Mitigated
by: the task plan constrains scope, the evidence bundle is auditable, and the
Reviewer agent (with no knowledge of the worker's conversation) would notice
unexpected changes.

**Supply chain attack via new dependency:** The dependency addition risk factor
(+15) and the approval requirement for dependency changes mean a worker cannot
silently add a malicious package. Human eyes review every dependency change.

**Credential leakage via logs:** Worker logs are written to
`~/.aedev/logs/<task_id>.jsonl`. The log writer filters known secret patterns
before writing (using the same regex patterns as the secret scanner). If a
secret does appear in a log, the event is flagged in the risk report.

**Lateral movement between repos:** Workers only receive a worktree for their
assigned repo. The Docker mount configuration does not expose any other repo
directories. Workers cannot access `~/.aedev/` directly.
