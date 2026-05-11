# Deferred items

Things explicitly skipped during the 1-day MVP and blockers surfaced when the
real Anthropic key + real GitHub token were wired up. Each entry has a *why
it's safe to defer* and a *what unblocks it* note.

## Things blocked on user action — STATUS as of final run

| # | Item | Status | Notes / next step |
| --- | --- | --- | --- |
| 1 | `ANTHROPIC_API_KEY` | ⏸ swapped to **subscription path** per redesign. The system now accepts long-lived OAuth tokens (`sk-ant-oat01-…`) generated via `claude setup-token` | **One outstanding step (yours)**: run `claude setup-token` on host, paste the resulting `sk-ant-oat01-...` token into `.env`'s `ANTHROPIC_API_KEY` slot, then I'll run the end-to-end |
| 2 | `GITHUB_TOKEN` (classic PAT) | ✅ `ghp_sDBPY7…` — full repo + workflow scopes; ingest verified end-to-end against real GitHub | — |
| 3 | `GITHUB_REPO=CTlanston/auto-evo-playground` | ✅ private repo seeded with `src/utils.py`, `tests/test_smoke.py`, `pyproject.toml`, `requirements.txt`, `.github/workflows/shadow-ci.yml` | — |
| 4 | GitHub labels (`agent:auto`, `agent:human-review`) | ✅ created | — |
| 5 | First test issue | ✅ created at https://github.com/CTlanston/auto-evo-playground/issues/1 with `agent:auto` label, **successfully ingested by orchestrator** | — |
| 6 | Docker daemon | ✅ running (29.4.2), both images built and validated; runner image now uses `--bare` mode + no `--max-budget-usd` |
| 7 | `SLACK_WEBHOOK_URL` | ✅ live, **multiple real posts confirmed** (end-of-day, terminal-error, rate-limit trip, rate-limit auto-resume) |
| 8 | Subscription tier | Pro (per user). Rate-limit window: ~5 hours rolling. Orchestrator now traps quota responses, writes `state/RATE_LIMITED` with a future timestamp, pauses globally, alerts Slack, auto-resumes when window expires (default 30min, override `RATE_LIMIT_BACKOFF_MINUTES`) |

**Net**: only item 1 (paste the OAuth token into `.env`) remains. Then:

```bash
docker compose down                              # I'll do this
docker compose up -d redis orchestrator          # I'll do this
docker compose logs -f orchestrator              # I'll tail this
# Issue #1 is already in the GitHub queue waiting.
# Orchestrator resumes from `paused` on container restart (PAUSED flag is in
# host-mounted state/ which we'll clear before bring-up).
```

## Things deferred by design (per IMPLEMENTATION_PROMPT_EN.md §3)

| Item | Why deferred | What unblocks it |
| --- | --- | --- |
| Vector DB / memory pool (Qdrant) | M4 work; profile already wired in `docker-compose.yml` (`--profile memory`) | Decide whether to keep embedded Qdrant or switch to hosted; add memory write-back at the merge step in `main.py` |
| Multi-issue concurrency | `_process_one` runs serially today | Wrap with `concurrent.futures.ThreadPoolExecutor.submit`; add per-issue worktree-lock and a Redis-backed queue (Redis is already in compose) |
| squid/tinyproxy egress whitelist | Production network isolation; today every container uses `network_mode: bridge` | Add a `proxy` service to compose with rules from `NETWORK_ALLOWLIST`; set `network_mode: "service:proxy"` on runner |
| GitHub webhook receiver | Today we 30-second poll | Add a small FastAPI/Starlette app at `orchestrator/webhook.py` exposing `/gh-webhook`; verify HMAC; push events into Redis |
| Full Guardian agent (real model call w/ historical state) | Phase D only does hard caps + a stubbed health check | Hook the real `runner.run_role("guardian", ...)` on the `GUARDIAN_INTERVAL_MINUTES` cadence; today the call goes through but the model stub returns `health=100, rec=continue` regardless |
| Production canary, mutation testing, coverage gate ≥80% | M3 work | `shadow-ci.yml` already has a `coverage-gate` job stubbed; raise `--cov-fail-under` once the test repo has real tests; add `mutmut`/`cosmic-ray` job |
| Real-repo write access (the agent merging into `main` of a real codebase) | M5 work, "第 5 周才考虑生产灰度" | Don't enable until ARCHITECTURE.md §7 failure modes are exercised against `auto-evo-playground` |

## Internal gaps the MVP papers over

| Gap | Where | Risk | Fix sketch |
| --- | --- | --- | --- |
| LOCAL_MODE Coder is a deterministic stub | `local_runner._stub_coder` | Pipeline tests don't validate model behaviour | Production path through Docker + claude CLI is the real Coder; LOCAL_MODE is dev-only by design |
| LOCAL_MODE Reviewer is a deterministic stub | `local_runner._stub_reviewer` | Same as above | Same — Reviewer in production runs Opus 4.7 with the prompt in `roles/reviewer.md` |
| LOCAL_MODE auto-greens CI | `main._do_ci_check` short-circuits when `LOCAL_MODE=1` and no signal exists | A syntactically broken implementation could pass | Add a `LOCAL_CI=pytest` knob that runs pytest on the cloned worktree before flipping CI green |
| Guardian's deterministic stub does not check complexity-drift / file-loop signals | `local_runner._stub_guardian` | Health score is unrealistic in LOCAL_MODE | Same as "Full Guardian agent" above |
| `mirror_to_github` is a no-op in LOCAL_MODE | `git_proxy.mirror_to_github` | Production path untested end-to-end here (blocked on item 2 above) | Once PAT can write to repo, the next coder→push will test this automatically |
| TDD gate doesn't verify tests *fail before* impl, only that prefixes exist | `main._check_tdd_invariant` | Coder could write `def test_x(): assert True` and a real impl, both pass — Reviewer prompt in `roles/reviewer.md` is the only line of defence | Have orchestrator check out each `test:` commit and run pytest, expecting non-zero exit; reject if green |
| No Coder file-whitelist enforcement at orchestrator level | `main._do_review` only catches forbidden paths via Reviewer | Coder's system prompt forbids `.github/`/Dockerfile/lockfiles, but a misbehaving Coder could still touch them | Add a `git diff --name-only` check after Coder push that auto-rejects forbidden paths *before* Reviewer even runs |
| `cleanup_worktree` never called | `git_proxy.cleanup_worktree` exists but no caller | Worktrees accumulate under `$WORKSPACE_ROOT` | Call from `main` once a PR transitions to `merged` (need to add that state transition; today the loop ends at `human_review`) |
| No `.dockerignore` for runner/orchestrator | Image bloat | Trivial | Add `.dockerignore` excluding `state/`, `workspaces/`, `.env*`, `__pycache__/` |
| `--max-budget-usd` not propagated from `.env` | Hard-coded as `1.50` (coder) / `0.50` (others) in `runner.py` | Per-role budgets aren't user-tunable | Promote `CODER_MAX_BUDGET_USD`, `REVIEWER_MAX_BUDGET_USD`, etc. to `.env` |
| Docker-out-of-Docker path translation is brittle | `runner.WORKSPACE_ROOT_HOST`, `main.STATE_DIR_HOST` | If `$PWD` in compose differs from where compose was invoked, mounts go wrong | Use `realpath`-equivalent at startup; fail-fast if `WORKSPACE_ROOT_HOST` doesn't exist on host |

## Convenience scripts not yet production-ready

| Script | Status |
| --- | --- |
| `scripts/setup.sh` | Works, builds both images and starts compose |
| `scripts/run-local.sh` | LOCAL_MODE entrypoint, used by today's tests |
| `scripts/inject-issue.sh` | Dual-mode (LOCAL stub vs direct DB insert) |
| `scripts/test-tdd-gate.sh`, `scripts/test-circuit-breaker.sh`, `scripts/test-paused-flag.sh` | Smoke tests; not idempotent against a running orchestrator (they `pkill main.py` and reset state); each forces `ORCHESTRATOR_POLL_INTERVAL_SECONDS=3` for fast iteration |

## CLI version drift watch

`claude` CLI 2.1.133 (current in runner image) **removed `--max-turns`**. Our
`runner/entrypoint.sh` now uses `--max-budget-usd` instead. If a future CLI
version restores `--max-turns` or renames flags again, regenerate the verified
list with:

```bash
docker run --rm --entrypoint sh claude-code-247/runner:latest -c 'claude --help' | grep -E '(output-format|model|append-system|allowedTools|permission-mode|max-)'
```

## Phantom-cost metering bug (May 8 freeze)

**Symptom:** Guardian froze dispatch on May 8 21:43 UTC with `recommends pause`. State/PAUSED was created; no .human companion (i.e. automatic, not user-triggered).

**Root cause:** Pollution in `state/orchestrator.db` runs table:
- 39 total runs, $22.07 cumulative cost_usd
- 27 rows (69%) had `input_tokens=output_tokens=0` but `cost_usd > 0` — stale state from previous run's cost being copied forward
- Same cost_usd value duplicated across multiple rows: `$0.19 × 6`, `$1.75 × 2`, `$1.03 × 2`, `$0.76 × 2`, `$0.43 × 2` — record_run double-write
- Real cost was ~$4.50, the other $17.56 was phantom

Guardian (Opus 4.7) read $22 daily_cost_usd vs ~$0 7-day average → token-spike alert per guardian.md rule 1 → ≥1 error condition → pause.

**Tactical patch (this commit A):** `main.py:run_guardian()` short-circuits `daily_cost_usd` to `0.0` when `ANTHROPIC_API_KEY` starts with `sk-ant-oat01-`. Phantom rows manually pruned.

**Root fix:** Make `record_run` idempotent and stop writing stale cost on zero-token runs. Tracked as https://github.com/CTlanston/auto-evo-playground/issues/6.
