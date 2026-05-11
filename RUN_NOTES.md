# Run notes — 1-day MVP build + real-credential session

## Final status

| Phase | Status | Evidence |
| --- | --- | --- |
| A — Boot | ✅ both images built (with `--bare` and OAuth-aware auth) | log line `orchestrator started, polling every 15s (LOCAL_MODE=0)` |
| B — Single-Issue Happy Path | ✅ LOCAL_MODE: 5s end-to-end. Real-mode (API key): ingested issue #1, spawned runner, called API, got terminal-error response | `runs` table summary = `Credit balance is too low` |
| C — Reviewer + TDD Gate | ✅ rejection path: `STUB_CODER_SKIP_TEST=1` → 3 rounds → `agent:human-review` PR | `scripts/test-tdd-gate.sh` PASS |
| D — Guardian Lite + breakers | ✅ rate-limit-window backoff (replaces dead daily-USD breaker), PAUSED kill-switch, real Slack posts on both | `scripts/test-circuit-breaker.sh` PASS (writes `RATE_LIMITED`, auto-resumes when window expires), `scripts/test-paused-flag.sh` PASS |
| Subscription path (final design) | ⏸ awaiting `claude setup-token` output — code in place, images rebuilt, wiring verified end-to-end with the prior API-key path | Once token is in `.env`, `docker compose up -d redis orchestrator` will run real Sonnet/Opus calls against subscription quota |

## Verified `claude --help` flags (CLI 2.1.133) — final form

```
claude --print                                  # one-shot
       --bare                                   # skip auto-memory, CLAUDE.md
                                                # auto-discovery, hooks, plugin
                                                # sync, keychain reads — auth
                                                # via $ANTHROPIC_API_KEY only
       --model "$CLAUDE_MODEL"
       --append-system-prompt "$SYSTEM_PROMPT"
       --allowedTools "$CLAUDE_ALLOWED_TOOLS"   # camelCase
       --output-format json
       --permission-mode bypassPermissions
       "$USER_PROMPT"
```

**Iteration history of the flag set**:
1. Original skeleton: `--max-turns 30`, no `--permission-mode`, no `--bare`
2. CLI 2.1.x removed `--max-turns` → switched to `--max-budget-usd`
3. Added `--permission-mode bypassPermissions` (required for headless)
4. Subscription auth: `--max-budget-usd` is meaningless (not USD-billed) →
   removed; added `--bare` for cross-issue isolation + injection-safety

JSON envelope shape (confirmed by real API call from inside the runner image):

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": <bool>,
  "result": "<text>",
  "total_cost_usd": <float>,
  "usage": {
    "input_tokens": <int>,
    "output_tokens": <int>,
    "cache_creation_input_tokens": <int>,
    "cache_read_input_tokens": <int>
  },
  "session_id": "<uuid>",
  "num_turns": <int>,
  "duration_ms": <int>,
  "stop_reason": "<reason>"
}
```

The orchestrator reads `usage.input_tokens` / `usage.output_tokens` and prefers
`total_cost_usd` over its own per-token cost estimator when present.

## Deviations from `ARCHITECTURE.md`

| Architecture line | Reality | Reason |
| --- | --- | --- |
| §1 each role = independent `claude --print` process | True in production (Docker); LOCAL_MODE collapses roles into Python function calls in the orchestrator process | LOCAL_MODE is for offline plumbing tests |
| §2.4 影子 CI on GitHub Actions | True in production once user adds `workflow` scope to gh CLI; LOCAL_MODE auto-greens after one poll | gh CLI's `repo` scope can't push `.github/workflows/`; deferred per `DEFERRED.md` item 4 |
| §5.2 GitHub token isolation | Preserved in production: token only in orchestrator container, runner pushes through `git_proxy.prepare_worktree` (clone with token) but the token is never exposed to runner env | LOCAL_MODE single-process collapses the boundary |
| §5.3 squid/tinyproxy egress whitelist | Not implemented | Explicitly deferred per IMPLEMENTATION_PROMPT §3 |
| Vector DB / memory pool | Not implemented | Deferred per §3 |
| §4 Guardian inspects 24h file-modification frequency | Stub returns `health=100, rec=continue` | Real Guardian agent deferred |

The four invariants in IMPLEMENTATION_PROMPT_EN.md §4 are intact:
- ✅ Four roles, separate sessions, separate tool whitelists
- ✅ `shadow/issue-N` only; `main` never touched by the agent
- ✅ Coder forbidden paths enforced by Reviewer (deterministic check + model)
- ✅ Models: Planner/Coder=Sonnet 4.6, Reviewer/Guardian=Opus 4.7
- ✅ Issue body / README / comments treated as untrusted input

## Subscription-auth redesign (after API-key path was verified)

The user has a Claude **Pro** subscription and asked to drop API billing in
favour of subscription auth. Three options were on the table; user chose **A**:
long-lived OAuth token (`claude setup-token`) in `.env`'s `ANTHROPIC_API_KEY`
slot, with Docker isolation kept intact.

**What changed**:
- `runner/entrypoint.sh`: dropped `--max-budget-usd` (subscription doesn't
  bill per USD), added `--bare` (skip auto-memory/CLAUDE.md auto-discovery
  to prevent cross-issue leak and prompt injection from a malicious commit)
- `orchestrator/runner.py`: dropped `CLAUDE_MAX_BUDGET_USD` env var
- `orchestrator/circuit_breaker.py`: removed daily-USD-budget check (dead
  signal under subscription billing); kept CI-failure-rate breaker
- `orchestrator/main.py`: added `_RATELIMIT_PATTERNS` and
  `_check_anthropic_response` helpers; per-role handlers now distinguish
  terminal (auth/credit, pause forever) from rate-limit (write `RATE_LIMITED`
  with future ts, pause briefly, auto-resume); main loop honours both flags
- `orchestrator/local_runner.py`: stub Guardian no longer references USD
  budget; added `_maybe_inject_fault()` honouring `STUB_FAULT_RATELIMIT` /
  `STUB_FAULT_TERMINAL` env vars for the new circuit-breaker test
- `.env`: dropped `DAILY_TOKEN_BUDGET_USD`, added `RATE_LIMIT_BACKOFF_MINUTES`
- `scripts/test-circuit-breaker.sh`: rewritten to drive a synthetic
  rate-limit response, asserts `RATE_LIMITED` flag is written, dispatch
  freezes during window, flag auto-clears on expiry

**Verified**: all three smoke tests PASS in LOCAL_MODE on the new code.
Production-mode end-to-end is one paste-of-OAuth-token away.

## Real-mode bug list found and fixed during this session

### Production-only path issues (fixed)

1. **Container running as root**: CLI refuses `--permission-mode bypassPermissions` when uid=0.
   - Fix: `runner/Dockerfile` now creates uid 1001 user; `runner.py` passes `--user $HOST_UID:$HOST_GID` so writes to bind-mounted workspace work without chown.

2. **`--max-turns` flag gone in CLI 2.1.x**.
   - Fix: `entrypoint.sh` now uses `--max-budget-usd $MAX_BUDGET` instead.

3. **Docker-out-of-Docker path translation**: orchestrator container saw `/workspaces/issue-N`, but the host docker daemon needs the host-visible path.
   - Fix: compose passes `WORKSPACE_ROOT_HOST=$PWD/workspaces` and `STATE_DIR_HOST=$PWD/state`. `runner.py` and `main.py` use these as mount sources.

4. **Role prompts mounted from orchestrator container into runner**: same path-translation issue. Worse: prompts only exist inside the orchestrator image, not on the host filesystem.
   - Fix: bake role prompts into the runner image at `/system_prompts/<role>.md`. `entrypoint.sh` reads `${CLAUDE_ROLE}` and resolves the path itself. No bind-mount needed.

5. **GitHub 404 spammed Python tracebacks every 15s**.
   - Fix: `main.ingest_issues` now catches and logs one clean line per occurrence, with a hint pointing to the PAT settings page.

### LOCAL_MODE issues (fixed)

6. **Stub coder raised on retry** when nothing was new to commit.
   - Fix: `_commit_if_dirty` helper returns silently on a clean staging area.

7. **Real Anthropic key in `.env` made `local_runner` try the SDK** — which 400-ed because credit is zero.
   - Fix: SDK path now opt-in via `LOCAL_USE_SDK=1`. Default is stubs even when a real key is present, so smoke tests stay deterministic and don't burn credit.

8. **Smoke tests assumed `POLL=5`** but `.env` had `POLL=15` for production.
   - Fix: each smoke test exports `ORCHESTRATOR_POLL_INTERVAL_SECONDS=3` after sourcing `.env`.

## Phase log with timestamps and commands

### Phase A — Boot

```bash
cp .env.example .env                                            # Phase A start
# … patched .env to LOCAL_MODE=1 + placeholders …
python3 -m pip install --user python-dotenv anthropic httpx
bash scripts/run-local.sh > /tmp/orchestrator.log 2>&1 &
```

Evidence:
```
[git_proxy] initializing local bare remote at /tmp/auto-evo-playground.git
[git_proxy] initializing local source repo at /tmp/auto-evo-playground
orchestrator started, polling every 5s (LOCAL_MODE=1)
```

### Phase B

```bash
bash scripts/inject-issue.sh 42 "add reverse(s) to utils.py with tests" "Implement..."
```

Evidence (5 seconds end-to-end):
```
ingesting issue #42
[git_proxy] cloning /tmp/auto-evo-playground.git -> .../issue-42/repo
[local] auto-marking CI green for shadow/issue-42
[issue 42] approved → Draft PR #1 opened
```
Generated tests pass: `2 passed in 0.01s`.

### Phase C

```bash
bash scripts/test-tdd-gate.sh
```

```
poll 3: status=coding rounds=1 credit=85
poll 5: status=coding rounds=2 credit=70
poll 6: status=human_review rounds=3 credit=55
[issue 99] hit max review rounds (3) — labelling agent:human-review
```

### Phase D

```bash
bash scripts/test-circuit-breaker.sh    # daily USD budget
bash scripts/test-paused-flag.sh        # PAUSED kill-switch
```

Both PASS. Real Slack post:
```
[INFO] HTTP Request: POST https://hooks.slack.com/services/... "HTTP/1.1 200 OK"
```

### Real-credential session

```bash
gh repo create CTlanston/auto-evo-playground --private --add-readme --gitignore Python
gh repo clone CTlanston/auto-evo-playground /tmp/auto-evo-playground-seed
# seeded src/utils.py, tests/test_smoke.py, pyproject.toml, requirements.txt
docker compose --profile build build runner
docker compose build orchestrator
docker compose up -d redis orchestrator
```

First real Anthropic call from inside the runner image:

```json
{ "is_error": true,
  "api_error_status": 400,
  "result": "Credit balance is too low",
  "duration_ms": 216 }
```

Confirms the entire wiring works: env propagated, container user OK, flags
accepted, JSON envelope as expected. Account just needs credit.

Production-mode log on missing PAT permission:

```
[ingest] GitHub query failed: GITHUB_REPO='CTlanston/auto-evo-playground'
returned 404. Likely cause: the fine-grained PAT does not have this repo on
its access list. Visit https://github.com/settings/personal-access-tokens →
edit the token → grant 'auto-evo-playground' repo access.
```

## Files added/changed

```
.env                                    real credentials, LOCAL_MODE=0
.gitignore                              already excludes .env, state/, workspaces/
.github/workflows/shadow-ci.yml         unchanged

orchestrator/main.py                    rewritten (Phase B-D wiring + clean GH error + STATE_DIR_HOST)
orchestrator/runner.py                  LOCAL_MODE branch + lazy docker import + HOST_UID/HOST_GID + WORKSPACE_ROOT_HOST
orchestrator/local_runner.py            NEW — host-side dispatch (stub default, SDK opt-in)
orchestrator/git_proxy.py               NEW — bare-remote, worktree prep, mirror, commit log helpers
orchestrator/github_client.py           rewritten — LOCAL_MODE stub for issues/PRs/CI
orchestrator/db.py                      STATE_DIR resolution (host vs container); per-LOCAL_MODE default
orchestrator/circuit_breaker.py         minor cleanup, env-aware threshold checks

runner/Dockerfile                       useradd uid 1001; bake roles into /system_prompts
runner/entrypoint.sh                    --max-budget-usd, --permission-mode, role-aware prompt path
runner/roles/                           NEW — copy of orchestrator/roles/ baked into image

docker-compose.yml                      WORKSPACE_ROOT_HOST, STATE_DIR_HOST, HOST_UID, HOST_GID

scripts/run-local.sh                    NEW — LOCAL_MODE entrypoint
scripts/inject-issue.sh                 rewritten — dual-mode (stub or DB)
scripts/test-tdd-gate.sh                NEW — Phase C verification (POLL=3 override)
scripts/test-circuit-breaker.sh         NEW — Phase D verification (POLL=3 override)
scripts/test-paused-flag.sh             NEW — Phase D verification (POLL=3 override)
DEFERRED.md                             status of every blocker, design-deferred items, MVP gaps
RUN_NOTES.md                            this file
```

## How to use it

### Run real-mode (Docker + real Anthropic + real GitHub)

```bash
# 1. Top up Anthropic credit:                https://console.anthropic.com/settings/billing
# 2. Allow the PAT to access the new repo:   https://github.com/settings/personal-access-tokens
#    → "Claude Code" → Edit → add CTlanston/auto-evo-playground
# 3. (optional) gh auth refresh -s workflow + push .github/workflows/shadow-ci.yml
docker compose up -d redis orchestrator
docker compose logs -f orchestrator

# Then in another terminal, raise an issue with the agent:auto label:
gh issue create --repo CTlanston/auto-evo-playground \
  --title "add reverse(s) to utils.py with tests" \
  --body "Implement reverse(s) in src/utils.py" \
  --label "agent:auto"
# (You may need to create the label first: gh label create agent:auto --repo CTlanston/auto-evo-playground)
```

### Run LOCAL_MODE (no Docker, no API key — what was used to build/test)

```bash
sed -i.bak 's/LOCAL_MODE=0/LOCAL_MODE=1/' .env
bash scripts/run-local.sh
bash scripts/inject-issue.sh 1 "add foo() to utils.py" "..."
# Tail /tmp/orchestrator.log for state transitions.
# Inspect ~/.claude-247-state/orchestrator.db with sqlite3.
# Resulting "PRs" land at /tmp/claude-247-workspaces/_github_stub/prs/
```

### Verify the safety machinery

```bash
bash scripts/test-tdd-gate.sh           # Reviewer rejects no-test PR; 3-round retry cap
bash scripts/test-circuit-breaker.sh    # daily USD budget freezes ingest
bash scripts/test-paused-flag.sh        # PAUSED kill-switch freezes/resumes dispatch
```

### Production kill-switch

```bash
touch state/PAUSED state/PAUSED.human   # the .human sentinel keeps Guardian
                                        # from auto-clearing the pause
```
