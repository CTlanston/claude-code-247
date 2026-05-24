# Known limitations

Issues that AutoDev v3 inherited from the inner engine, plus its own gaps.
Each one is either a HOLD item in `reports/human-hold.md` or a tracked
backlog task.

## Inherited from Auto-Evo inner engine

| ID | Issue | Tracked |
| --- | --- | --- |
| INNER-1 | `record_run` double-write under subscription auth → phantom `daily_cost_usd`. Currently masked by the `_is_subscription` hotfix in `main.py:run_guardian`. | GitHub issue #6 / TASK-007 |
| INNER-2 | `mirror_to_github` no-op in current setup — runner pushes directly to GitHub instead of via bare-repo proxy. Means runner containers can see `GITHUB_TOKEN`. | DEFERRED.md |
| INNER-3 | TDD gate verifies prefixes only, not red-then-green test behaviour. A truly clever Coder could fake TDD. | DEFERRED.md |
| INNER-4 | LOCAL_MODE auto-greens CI when no signal exists — a syntactically broken implementation could pass. | DEFERRED.md |
| INNER-5 | Worktrees accumulate under `WORKSPACE_ROOT`; `cleanup_worktree()` exists but has no caller. | DEFERRED.md / TASK-006 |

## AutoDev v3 specific

| ID | Issue | Why | When to fix |
| --- | --- | --- | --- |
| AUTODEV-1 | Recovery manager treats `health_status` in `{bootstrap, unknown}` as needing repair, then immediately marks green on the next cycle. This means the first cycle after corruption is a no-op. | Defensive — better a no-op than a thrash. | If you see cycles stuck "bootstrap → green → bootstrap" forever, investigate the underlying state corruption. |
| AUTODEV-2 | `BacklogManager._set_status` is line-based regex; backlog files with multi-line task entries are silently ignored. | We pinned the format up front (one task per line). | Only if you need multi-line task bodies. |
| AUTODEV-3 | `CommandManager` reads `commands/inbox.md` as plain text; if you append while a cycle is in progress, you could race the archive step. | Race is benign — the same hash detection prevents re-application. | Not a real bug; logged for clarity. |
| AUTODEV-4 | `InnerEngine._run_in_process` is a stub; only `subprocess` backend is functional. | Subprocess is safer (crash isolation). | If you ever need to call inner engine from a long-running process for performance reasons. |
| AUTODEV-5 | `tmux` is required for `start_tmux_autodev.sh`. Not installed on this host. | Optional path — launchd alternative exists. | `brew install tmux` if you want tmux-based detached supervisor. |
| AUTODEV-6 | Host `claude` CLI not installed; executor falls back to Docker. Slower per call (~5s container startup overhead). | The Docker fallback works; speed is secondary in 15-min cycle cadence. | `npm install -g @anthropic-ai/claude-code && claude setup-token` |
| AUTODEV-7 | The cost controller parses `HUMAN_CONFIG.md` line-by-line without a real YAML library. If you use nested structures, only the top-level keys are read correctly. | Avoiding a yaml dependency. | Add PyYAML to `orchestrator/requirements.txt` if your config needs richer structure. |

## What v3 explicitly does NOT do

- No webhook receiver. The supervisor polls `commands/inbox.md` and the
  inner engine polls GitHub every 30s. A push receiver would cut latency
  but adds an HTTP server.
- No vector memory / Qdrant. The `--profile memory` in `docker-compose.yml`
  is still wired but unused.
- No multi-issue concurrency. The supervisor runs strictly serial — both
  to keep the rate-limit window happy and to keep state.json single-writer.
- No auto-merge of PRs. Spec §2.3: humans only.
- No production deployment. Spec §2.3.

## When in doubt

Read `AUTODEV_V3_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md` again. It's the
ground truth for what v3 is supposed to be.
