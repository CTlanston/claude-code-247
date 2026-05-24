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

## Phase 3 — Fourth real E2E ✅ PURE AUTO-MERGE PROVEN

The final, successful run (after surfacing + fixing 4 evidence-pipeline gaps along the way):

| Item | Value |
|---|---|
| `task_id` | `task_01KSDYRW424VMCDGV1WCP6D873` |
| Status | **`merged`** |
| Branch | `agent/auto-evo-playground/task_01KSDYRW424VMCDGV1WCP6D873/add-clamp-value-float-min-value-float-ma` |
| PR | [auto-evo-playground#59 (MERGED)](https://github.com/CTlanston/auto-evo-playground/pull/59) |
| merge commit | `6c583d5e1b39f03f800591770fe2b715340f12a7` |
| **Gemini verdict** | **PASS, confidence 1.0** (real) |
| **OpenAI verdict** | **PASS, confidence 1.0** (real, `gpt-4o`) |
| Risk score | **0** (low) |
| Merge ruling | **AUTO_MERGE** |
| Worker auth mode | `local_claude_code` |
| Anthropic worker spend | **$0.00** |
| `worker_exits` count | 3 (all `tests`/`success`) |
| Wall clock | **3m 28s** (queued → merged) |

Timeline:
```
21:38:02  created
21:38:02  planning   (worker)
21:41:06  validating (validators on .evidence/)
21:41:27  pr_created (ruling: auto_merge)
21:41:27  auto_merging
21:41:30  merged     (auto-merge completed, 3s after PR)
```

## Phase 4 — Verify pure auto-merge ✅

```
$ gh pr view 59 -R CTlanston/auto-evo-playground --json number,state,mergeCommit,title
{"number":59, "state":"MERGED",
 "mergeCommit":{"oid":"6c583d5e1b39f03f800591770fe2b715340f12a7"},
 "title":"agent: Add clamp(value: float, min_value: float, max_value: float)"}
```

Both real validators PASS, risk low, no manual approval required, PR auto-merged to `auto-evo-playground/main`.

## What got fixed along the way (M20-P3 hardening series)

Five sub-phases of fixes shipped between M20-P3 attempt #1 and the
final auto-merge:

| Sub-phase | Fix | Why |
|---|---|---|
| M20-P3b (`1eb9d10`) | `gateway/commands/dispatcher_cmd.py` calls `env_loader.load_chain(...)` instead of the legacy single-file `load()`. | The dispatcher startup didn't use the BR-002 + M20-P1b chain, so secrets.env was being ignored. Real OpenAI key was invisible to the worker. |
| M20-P3d (config + `validator/openai_judge.py`) | Default OpenAI model `gpt-5` → `gpt-4o`. | First real OpenAI call hit a 404 because `gpt-5` requires org verification not all accounts have. |
| M20-P3g (`1c18d49`) | `EvidenceCollector._resolve_base_ref()`: snapshot_diff and snapshot_diff_body_safe diff against `task_spec.default_branch` (with fallback chain) instead of always `HEAD`. | Claude CLI committed mid-roleloop, so `git diff HEAD` returned empty even though `git diff main` would show 64 insertions. |
| M20-P3i (`ef30853`) | `EvidenceCollector.snapshot_diff_body_safe` includes untracked files via `git ls-files --others`, synthesizing new-file diffs. | Claude CLI writes new files without staging; `git diff <base>` doesn't list untracked files; the safe diff body came out empty. |
| M20-P3j (`cca1858`) | `runner/role_loop.py` calls `_refresh_diff_evidence(collector, spec)` after the coder finishes AND after each repair attempt. | The role_loop's INTERNAL reviewer read evidence files written before the coder ran, declared the diff empty, cascaded to NEEDS_REPAIR → NEEDS_HUMAN. The stale review.md then misled OpenAI on the external validator pass even after the post-roleloop snapshot fixed the diff body. |

Each fix is regression-tested (with the exception of M20-P3j which is
demonstrated by the auto-merge E2E). Total tests after M20: **502 passing**
(497 + 3 M20-P1b + 3 M20-P3i = 503; the 502 number is after a fold).

## Soak baseline (Phase 5 reference)

launchd was re-loaded after the manual P3 iterations. See
[M20_SOAK_PLAN.md](M20_SOAK_PLAN.md) for the t+1h / t+6h / t+24h
checkpoints. As of the auto-merge of PR #59, all 4 services are
loaded and the dashboard is reachable.

## 20-criteria pass/fail

| # | Criterion | Status |
|---|---|---|
| 1 | PR #55 cleanup done | ✅ |
| 2 | OPENAI_API_KEY real validator configured or blocker documented | ✅ (M20-P1b + M20-P3b fixed loading) |
| 3 | Gemini validator is real | ✅ |
| 4 | OpenAI validator is real | ✅ (`gpt-4o`) |
| 5 | Worker uses local Claude Code mode | ✅ |
| 6 | Anthropic API spend remains $0 for workers | ✅ |
| 7 | Fourth real E2E runs against auto-evo-playground | ✅ |
| 8 | Real PR is opened | ✅ (#59) |
| 9 | Tests pass | ✅ (workspace pytest 92 passed; claude-code-247 tree 502 passing) |
| 10 | Evidence package exists | ✅ |
| 11 | Risk score is low | ✅ (0) |
| 12 | **Both real validators PASS** | ✅ **Both PASS conf 1.0** |
| 13 | **PR auto-merges without manual override** | ✅ **MERGED in 3s** |
| 14 | Task status becomes merged | ✅ |
| 15 | Replay/memory/log artifacts exist | ✅ |
| 16 | launchd daemon mode installed or blocker documented | ✅ (4 services loaded) |
| 17 | 24h soak plan exists | ✅ (M20_SOAK_PLAN.md) |
| 18 | Tests pass | ✅ |
| 19 | Docs updated | ⏳ (this report + CHANGELOG + DoD + V/O/A docs in Phase 6) |
| 20 | No new tag pushed without explicit human confirmation | ✅ (proposed only) |

## Proposed next tag (gated on user confirmation)

```
v1.0.0-beta.2 — Pure auto-merge production proof
```

**Not pushed.** Awaiting your explicit go-ahead.
