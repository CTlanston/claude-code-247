# Repo onboarding

Two equivalent paths: CLI wizard and dashboard form. Both call
`orchestrator.onboarding.onboard()` so validation is identical.

## CLI

```bash
claude247 repo add                        # interactive
claude247 repo add --from-spec spec.json  # batch, JSON spec
claude247 repo add --no-probe             # skip git probes (CI fixtures)
```

The wizard asks for:

- repo id (short slug — `my-repo`)
- GitHub owner + repo name
- local clone path
- default branch
- test command (optional)
- lint command (optional)
- forbidden_paths (comma-separated; defaults to safe set)
- auto-merge eligibility (default: off)

## Dashboard

`http://127.0.0.1:8423/onboarding` is the same form rendered in HTML.
Submitting POSTs to `/onboarding`; on validation failure the page
re-renders with errors inline.

## Validation gates

| Check | Where | Failure |
|---|---|---|
| Required fields present | `validate_spec` | rejects spec |
| id not already in registry | `validate_spec` | rejects spec |
| forbidden_paths non-empty | `validate_spec` | rejects spec |
| local_path exists | `probe_local_path` | rejects (skip with `--no-probe`) |
| local_path is a git repo | `probe_local_path` | rejects (skip with `--no-probe`) |
| `origin` remote matches `owner/repo` | `probe_local_path` | rejects (skip with `--no-probe`) |
| default_branch present locally | `probe_local_path` | rejects (skip with `--no-probe`) |
| forbidden_paths includes `.env` | `validate_spec` | warns only |

## What gets written

1. The spec is appended to `~/.claude-code-247/repos.yaml` (creates
   the file if absent).
2. The full registry is re-parsed and synced to `state/claude247.db`
   (`repos` table).
3. `.agent/*.md` stubs can be created with `claude247 memory init
   --repo <id>`.

## Removing a repo

Edit `repos.yaml` and remove the entry. `claude247 repos` (with the
default `--sync` flag) prunes the SQLite mirror on the next call.
