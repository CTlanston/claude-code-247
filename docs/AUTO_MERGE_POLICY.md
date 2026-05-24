# Auto-merge policy

## Risk bands

| Score | Level  | Default action |
|-------|--------|----------------|
| 0-30  | low    | AUTO_MERGE eligible if all gates pass |
| 31-70 | medium | WAITING_APPROVAL — operator must approve |
| 71+   | high   | BLOCKED — manual review only |

Tunable via `config/policies.yaml → risk_levels`.

## Factors (weights from `policies.yaml → risk_score.factors`)

Each factor below adds its weight to the score when triggered. Final
score is clamped to 100.

| Factor | Default weight | Trigger |
|---|---|---|
| `changed_lines_per_50` | 4 each (ceiling 40) | every 50 lines beyond the first 50 |
| `files_touched_per_3` | 3 each (ceiling 30) | every 3 files beyond the first |
| `forbidden_path_touch` | 100 | any file matches repo forbidden_paths |
| `sensitive_path_touch` | 30 | lockfiles, migrations, schema.sql |
| `workflow_change` | 40 | anything under .github/** |
| `dependency_change` | 25 | pyproject.toml, requirements*.txt, package.json, etc. |
| `test_change_without_code` | 10 | only tests/ touched |
| `code_change_without_test` | 20 | code touched, no test added |
| `auth_security_files` | 40 | matches auth/security/credential globs |
| `network_code_change` | 15 | API / client / network paths |
| `database_migration` | 30 | (reserved for M11+; not auto-detected yet) |
| `orchestrator_core_change` | 60 | orchestrator/** |
| `runner_sandbox_change` | 60 | runner/** |
| `validator_change` | 60 | validator/** |
| `ci_failure` | 50 | last CI run failed |
| `validator_disagreement` | 40 | Gemini and OpenAI judges disagree |
| `large_deletion` | 20 | > 200 lines deleted |
| `low_test_coverage` | 15 | (reserved; coverage hookup in M11+) |

## Hard guardrails (always block, regardless of score)

- `forbidden_path_touch` — even on a "low" overall score, this routes
  to BLOCKED.
- validator `FAIL` from either judge — BLOCKED.
- CI failed — BLOCKED.
- local tests failed — BLOCKED.
- `system.allow_remote_writes: false` — caps at WAITING_APPROVAL.
- `repo.auto_merge.enabled: false` — caps at WAITING_APPROVAL.
- `risk > repo.auto_merge.max_risk_score` — caps at WAITING_APPROVAL.
- validators disagree or PASS with evidence gap — WAITING_APPROVAL.

## Approval lifecycle

```
not_required → required → approved   (CLI: claude247 approve-merge)
                       → rejected  (CLI: claude247 reject-merge)
                       → expired   (TTL not yet enforced)
```
