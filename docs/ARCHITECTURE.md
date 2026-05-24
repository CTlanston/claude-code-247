# Architecture

## Five planes

```
Docker runner          worker execution plane (per-task container)
Claude Remote/Dispatch human control plane
GitHub                 source-of-truth collaboration plane
FastAPI + HTMX UI      observability plane
SQLite (+ optional Qdrant) memory and state plane
```

## Module map

```
claude247/                  → python package (this repo) ──┐
                                                            │
orchestrator/               (long-running brain)            │
  config.py                 config + policy loader          │
  ids.py                    ULID + utc timestamp helpers    │
  logging_setup.py          JSON stderr logger              │
  log_indexer.py            structured logs + FTS5 search   │
  repo_registry.py          repos.yaml → SQLite mirror      │
  task_manager.py           lifecycle state machine         │
  command_queue.py          enqueue/claim/complete          │
  runner_manager.py         spawn workers (docker | local)  │
  risk_score.py             0-100 PR risk                   │
  merge_policy.py           AUTO_MERGE | WAITING | BLOCKED  │
  budget_manager.py         per-repo per-day counters       │
  notification_manager.py   ntfy + log                      │
  alert_deduper.py          fingerprint + window collapse   │
  replay_manager.py         failure replay package          │
  secret_scanner.py         diff secret patterns            │
  path_guard.py             forbidden_paths enforcement     │
                                                            │
runner/                     (per-task container)            │
  Dockerfile                python+git+gh+node+claude       │
  entrypoint.sh             execs runner.worker             │
  worker.py                 evidence + commands + roles     │
  claude_cli.py             `claude --print` wrapper        │
  auth.py                   local CLI / API fallback        │
  role_loop.py              planner→coder→reviewer→repair   │
  prompt_builder.py         role prompt templates           │
  roles/*.md                role system prompts             │
  evidence_collector.py     .evidence/ writer + cmd runner  │
                                                            │
validator/                  (evidence-only judges)          │
  judge_contract.py         typed contract + prompt         │
  mock_judge.py             rule-based fallback             │
  gemini_judge.py           Gemini 2.5 Pro REST             │
  openai_judge.py           OpenAI-compatible REST          │
  validation_policy.py      both-PASS-or-human gate         │
                                                            │
memory/                     (durable + searchable)          │
  schema.sql                full SQLite schema              │
  db.py                     connection helpers              │
  repo_memory.py            .agent/*.md per repo            │
  vector_store.py           SQLite FTS5 or Qdrant           │
  compiler.py               daily/weekly digest             │
                                                            │
gateway/                    (control plane)                 │
  cli.py                    claude247 entry point           │
  doctor.py                 environment checks              │
  commands/*.py             status/start/pause/etc CLI      │
                                                            │
dashboard/                  (observability)                 │
  app.py                    FastAPI + HTMX                  │
  templates/*.html          minimal CSS, mobile-tolerant    │
                                                            │
config/                                                     │
  default.yaml              system config defaults          │
  policies.yaml             risk + merge defaults           │
                                                            │
scripts/                                                    │
  install_launchd.sh        load com.claude247.* jobs       │
  uninstall_launchd.sh      unload (and optionally purge)   │
  doctor.sh, smoke_test.sh  thin wrappers                   │
                                                            │
~/.claude-code-247/         runtime state (NOT in repo)     │
  repos.yaml                                                │
  config.yaml, policies.yaml (user overrides)               │
  state/claude247.db                                        │
  workspaces/<task_id>/                                     │
  logs/                                                     │
  replays/                                                  ┘
```

## Data flow for one task

1. `claude247 start --repo X --goal "..."` → command_queue inserts a
   `start_task` row.
2. Orchestrator dispatches: task_manager.create_task → status `queued`.
3. runner_manager.prepare_workspace clones the repo with
   `git clone --shared`, checks out `agent/<repo>/<task>/<slug>`.
4. runner.worker boots in container (or local subprocess), reads the
   task spec from stdin, runs repo's tests/lint/build, snapshots the
   diff + manifest into `.evidence/`.
5. If `--allow-roles`, planner → coder → reviewer (→ repair, up to 3)
   are invoked via separate `claude --print` calls (no
   `--resume`, so Reviewer cannot see Coder context).
6. The orchestrator computes risk_score from the diff stats, runs the
   validators against `.evidence/`, applies merge_policy.
7. Decision routes the task into `auto_merging` (PR opened, low risk,
   all gates green), `waiting_for_approval` (medium risk or any
   validator concern), or `failed`/`stuck` (high risk, repair
   exhausted).
8. notification_manager pushes `pr_created` / `approval_required` /
   `auto_merge_completed` via ntfy.

The orchestrator never directly mutates GitHub from CLI/UI code paths;
every push/merge goes through the command_queue + the
`system.allow_remote_writes` gate.

## Safety gates

- `system.allow_remote_writes` — global ON/OFF for push + merge.
- `repo.auto_merge.enabled` — per-repo opt-in even when the global
  flag is on.
- `risk_score` thresholds — low (≤30) eligible, medium (31-70) requires
  approval, high (>70) blocked.
- `forbidden_path_touch` — always blocks (even on low-risk PRs).
- `validator_disagreement` — always routes to human.
- `validators.require_two_validators` — both must PASS to auto-merge.
