# M20 — Production Proof Report

**Status**: IN PROGRESS · Phase 0 + 1 complete · Phase 3+ GATED on OPENAI_API_KEY decision
**Predecessor tag**: `v1.0.0-beta.1`
**Target tag** (gated on user confirmation): `v1.0.0-beta.2 — Pure auto-merge production proof`

---

## Phase 0 — Cleanup PR #55 ✅

| Item | Value |
|---|---|
| Pre-state | PR #55 OPEN, draft, `agent/auto-evo-playground/task_01KSDRQDNN29FSNRYYSFC4G59J/...` |
| Action | `gh pr close 55 -R CTlanston/auto-evo-playground -d -c "..."` |
| Result | ✅ Closed; branch deleted. |

---

## Phase 1 — Real validator configuration: ⛔ GATING BLOCKER

### What's in the operator's secret store

| File | Mode | Keys present (names only — never values) |
|---|---|---|
| `~/.claude-code-247/.env` | `-rw-------` | `GEMINI_API_KEY`, `NTFY_SERVER`, `NTFY_TOPIC` |
| `~/.claude-code-247/secrets.env` | `-rw-------` | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `NTFY_SERVER`, `NTFY_TOPIC` |

### Why doctor says "neither set"

`gateway/doctor.py::check_validator_keys` (and the directive's "is the key in env") inspect `os.environ` at the doctor's own process startup. They do NOT call `env_loader.load_chain(...)` first. So:

```
$ .venv/bin/python -m gateway.cli doctor
...
• validator API keys: neither GEMINI_API_KEY nor OPENAI_API_KEY set; validators will use mocks
```

is honest about **what's exported into this python process's env** — not about what's in any `.env` file on disk.

### Why the dispatcher path picks up GEMINI but not OPENAI

The BR-002 env_loader (`orchestrator/env_loader.py::discover_env_paths`) walks:
1. `<project_root>/.env`
2. `<cwd>/.env`
3. `<user_config_dir>/.env`  ← `~/.claude-code-247/.env`

It **does not** include `<user_config_dir>/secrets.env`. So when the dispatcher subprocess starts, it loads `.env` (which has `GEMINI_API_KEY`) but never touches `secrets.env` (which has `OPENAI_API_KEY`).

The operator has a separate `with-secrets` wrapper for interactive shells that sources `secrets.env`, but **launchd daemons don't have shell wrappers** — and that's exactly the M20 scenario we're trying to prove.

### Required diagnosis fields (per directive)

```
Gemini validator real: YES (loaded from ~/.claude-code-247/.env via env_loader)
OpenAI validator real: NO (key is in secrets.env which is NOT auto-loaded)
Mock validators used:  OpenAI is mock — would force NEEDS_HUMAN per M18-P1
Worker auth mode:      local_claude_code
Anthropic API used for workers: NO (worker_mode strips ANTHROPIC_API_KEY)
```

### Decision required from operator

Three fixes solve this. They have different scope:

**Option A — Operator-side (no code change)**:
Add `OPENAI_API_KEY=...` to `~/.claude-code-247/.env`. Today the env_loader will pick it up. Drawback: conflates `.env` (general config) with `secrets.env` (dedicated secret store).

**Option B — BR-002 follow-up (recommended)**:
Extend `discover_env_paths()` to also probe `<user_config_dir>/secrets.env` so it's auto-loaded under the same precedence rules. This is a 1-line code change + 1 regression test. It fixes the launchd-daemon-can't-see-secrets case permanently. Could ship as **M20-P1b**.

**Option C — Wrapper-side**:
Always launch dispatcher via `with-secrets claude247 dispatcher --once`. Drawback: doesn't help launchd daemons.

Per directive: "Do not run a fake 'production proof' with OpenAI mock." → I am stopping before Phase 3 until this decision is made.

---

## Phase 2 — launchd install + verify ✅

```
$ scripts/install_launchd.sh
installed /Users/lanston/Library/LaunchAgents/com.claude247.dashboard.plist
installed /Users/lanston/Library/LaunchAgents/com.claude247.orchestrator.plist
installed /Users/lanston/Library/LaunchAgents/com.claude247.dispatcher.plist
installed /Users/lanston/Library/LaunchAgents/com.claude247.backup.plist
```

| Service | State | PID | Last exit |
|---|---|---|---|
| `com.claude247.dashboard` | loaded, KeepAlive | 42273 (live) | 0 |
| `com.claude247.orchestrator` | loaded, 60s tick | - (scheduled) | 0 |
| `com.claude247.dispatcher` | loaded, 30s tick | - (scheduled) | 0 |
| `com.claude247.backup` | loaded, daily 03:17 UTC | - (scheduled) | 0 |

- Dashboard `GET /healthz` → `{"ok": true}` (verified at `t=0`)
- Dashboard stderr log (198 bytes) contains only uvicorn startup info
  — no errors.
- All 4 launchd plists now include `CLAUDE247_CONFIG` (BR-002 fix from M19).

**Known minor issue**: `scripts/doctor_launchd.sh` uses `sed -n '$-4,$p'`
which is GNU-sed-specific; BSD sed (macOS default) bails out partway
through. Not blocking — direct `launchctl list` shows the state, and
`claude247 doctor` covers the same fields. Filed as a separate small fix
candidate; doesn't gate M20.

## Phase 5 — 24h soak plan ✅

Written to [M20_SOAK_PLAN.md](M20_SOAK_PLAN.md). Includes:
- Baseline at `t=0` (4 services loaded, dashboard live).
- Re-runnable health-check block (8 commands).
- Explicit failure conditions ("what counts as a soak failure").
- Stop / uninstall commands for clean teardown.
- Checkpoint schedule at t+1h, t+6h, t+24h.
- Why the soak proves idle-safety / $0 Anthropic spend.

## Phase 3 / 4 — gated

Waiting for Phase 1 decision before running the clamp E2E.

## Phase 6 — gated

Will only propose `v1.0.0-beta.2` if all 20 success criteria are met. The current Phase 1 gap means we are not at "production-ready" yet.
