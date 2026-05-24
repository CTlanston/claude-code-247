# M21 — GA Readiness Report

**Status**: IN PROGRESS · Phase 0 baseline complete
**Predecessor tag**: `v1.0.0-beta.2`
**Target tag** (gated on full M21 + explicit user approval): `v1.0.0`

---

## Phase 0 — Baseline verified

### Repo state

| Field | Value |
|---|---|
| Current branch | `claude247/v1` |
| HEAD | `560227ebb6f29f3bec6753f26caadf884a608880` |
| `main` (local) | `560227e` (in sync with HEAD) |
| `claude247/v1` (local) | `560227e` |
| `origin/main` | `560227e` (in sync) |
| `origin/claude247/v1` | `560227e` (in sync) |
| Working tree | clean |
| Latest tag | `v1.0.0-beta.2` (annotated, at `560227e`) |
| Latest GH release | `v1.0.0-beta.2 — Pure auto-merge production proof` (pre-release) |

### `pytest -q --no-cov`

```
502 passed in 14.28s
```

### `claude247 doctor` (summary)

```
✓ macOS host: Darwin 25.3.0
✓ python >= 3.11
✓ git
• docker: daemon not reachable (expected — local backend covers it)
✓ gh auth
✓ claude CLI: 2.1.142
✓ config source: loaded ~/.claude-code-247/config.yaml (kind=user); env files probed: 3
✓ auth mode: worker_mode=local_claude_code, usable=True
✓ sqlite3
✓ state dir writable
✓ sqlite db init: schema v3
✓ repos.yaml: 1 repo registered
• dashboard port free: 8423 busy (BY OUR OWN dashboard daemon — actually healthy)
✓ ntfy notifications
• validator API keys: doctor sees shell env only (runtime DOES load from secrets.env)
✓ launchd: 4/4 services loaded
OK
```

The two `•` warnings are both benign:
- `docker daemon not reachable` is fine — the local backend covers it.
- `dashboard port busy` means our own KeepAlive dashboard is running on 8423; healthy. Filed as small UX nit for doctor to detect "is my own dashboard already running".
- `validator API keys` doctor check looks at `os.environ` at probe-time, which the dispatcher does not yet have. The actual runtime via `load_runtime_config()` reports `gemini_key_present=True, openai_key_present=True` thanks to M20-P1b. Filed as small UX nit for doctor to use `load_runtime_config(apply_env=False)` instead.

### `claude247 status --plain`

```
System: running
Repos enabled: 1
Active tasks: 0
Stuck tasks: 0
Need approval: 6
Today: 2 completed, 4 failed
Next actions:
- claude247 approve-merge --repo auto-evo-playground --pr 58
```

"Need approval: 6" + "Today: 2 completed, 4 failed" reflect the M19/M20 iteration history — multiple cancelled or pending-approval tasks plus the slugify/dedupe/clamp PRs already merged. Not M21 work.

### launchd state

| Service | State | PID | Last exit |
|---|---|---|---|
| `com.claude247.dashboard` | loaded, KeepAlive | 42273 (live since M20-P2) | 0 |
| `com.claude247.orchestrator` | loaded, 60s tick | scheduled | 0 |
| `com.claude247.dispatcher` | loaded, 30s tick | scheduled | 0 |
| `com.claude247.backup` | loaded, daily 03:17 UTC | scheduled | 0 |

`/healthz` → `{"ok": true}` ✓

## Phase 1 — Soak observation: PARTIAL (see M20_SOAK_RESULT.md)
## Phase 2 — Deepen worker_exits: NOT STARTED
## Phase 3 — Failure-mode drills: NOT STARTED
## Phase 4 — Verification task: NOT STARTED
## Phase 5 — GA gate: NOT STARTED
## Phase 6 — Final report: NOT STARTED
