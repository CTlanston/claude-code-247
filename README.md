# claude-code-247

> Your local-first, multi-repo, 24/7 autonomous coding coworker. The Mac
> stays on; Claude Code authenticated locally drives Docker-isolated
> workers across every repo in your registry, opens draft PRs on GitHub,
> runs external validators, scores risk, and merges low-risk changes
> automatically — gated by your phone if anything bigger.

## ⚡ Architecture at a glance — dual kernel, single product

`claude-code-247` is one product OS with two cooperating kernels:

| Layer | Implementation | Role |
|---|---|---|
| **Control plane** | **TypeScript `aedev`** (pnpm monorepo) | Primary CLI, daemon, dashboard, state machine, mission intake, roadmap, task graph, approvals, memory, risk, preview/deploy orchestration, evidence bundle. |
| **Execution kernel** | **Python `claude247`** (v1.0.0 GA) | Mature Docker worker runtime, headless `claude --print` invocation, Gemini + OpenAI judges, GitHub PR creation. Invoked by `aedev` during the parity window. |
| **Bridge** | `@aedev/claude247-bridge` | Enqueues tasks into the Python state DB, polls status, imports evidence back into `aedev`'s SQLite. |

This dual-kernel design is recorded in
[ADR-0009](docs/adr/0009-aedev-as-primary-control-plane.md), which supersedes
[ADR-0008](docs/adr/0008-product-spine-python-now-typescript-experimental.md).
`aedev` is the primary entry point for new product-OS work; the Python kernel
continues to drive worker execution and validator orchestration until the
TypeScript runtime reaches parity (see
[`docs/aedev-prototype-status.md`](docs/aedev-prototype-status.md) for the
parity gate list).

## What you get

- **Multi-repo from day one.** One registry, many repos. Per-repo budget,
  risk policy, allowed/forbidden paths.
- **Local-first execution.** Mac + Docker. Your authenticated Claude
  Code session is the default; the paid API is opt-in.
- **Mobile control.** `claude247 status --plain` and `claude247
  status-board --plain` are built for SMS-sized output. ntfy.sh pushes
  for approvals and stuck tasks.
- **External validator isolation.** Gemini 2.5 Pro and an OpenAI-compatible
  judge see only the evidence package — never the Coder's conversation.
- **Low-risk auto-merge** with score 0–100; medium asks your phone, high
  blocks.
- **Long-term memory** that compiles failures, lessons, and decisions
  back into per-repo `.agent/*.md` files.
- **Failure replay** for any task.
- **Live read-only watchdog dashboard** (new in v1.0.0 / M22b) — see
  below.

## Quick start

`aedev` is the primary control plane. The Python `claude247` kernel is
installed alongside it during the parity window and handles worker execution
underneath.

```bash
# 1. Install the Python execution kernel (mature, GA v1.0.0)
make install                    # creates venv + installs deps + launchd plists
claude247 doctor                # verify kernel environment

# 2. Install the TypeScript control plane
pnpm install
pnpm -r build

# 3. Initialize aedev home (~/.aedev/)
aedev init

# 4. Start the aedev daemon (port 7247) — control plane + dashboard
aedev daemon start
open http://localhost:7247

# 5. Submit a mission via the control plane (two-step approval)
aedev intake "refactor the auth middleware in repo my-repo"
aedev mission list              # find the mission id
aedev mission approve <id>      # explicit approval — no self-approve

# 6. Inspect status / tasks via the control plane
aedev status --plain
aedev task list

# 7. Read-only watchdog (Python kernel) — phone-friendly
claude247 status-board --plain
claude247 watchdog --plain
claude247 status-board --json
claude247 status-board --write-md M22_WATCHDOG_DASHBOARD.md
```

During the parity window, some kernel-level operations are still invoked
directly via `claude247` (worker launch, validator orchestration, GitHub
PR creation). The `@aedev/claude247-bridge` package routes `aedev` missions
through the Python kernel automatically — see
[ADR-0009](docs/adr/0009-aedev-as-primary-control-plane.md) and
[`docs/aedev-prototype-status.md`](docs/aedev-prototype-status.md).

## Live watchdog dashboard

A read-only operations dashboard for "is the 24/7 daemon actually OK
right now?" Designed to be safe to run from a phone while the
dispatcher is mid-tick — the SQL is SELECT-only and the contract is
asserted by a regression test
(`tests/unit/test_status_board.py::test_read_only_does_not_mutate_db`).

**Web (Apple-style):** http://127.0.0.1:8423/status-board

- **Activity-ring** soak progress (recolors green / blue / red by
  state) using only inline SVG + CSS — no charting library
- **Auto-refresh** every 15s (configurable 5 / 15 / 30 / 60s / off);
  fetches `/status-board.json`, updates DOM in place, briefly tints
  cards that changed — no full reload, no flicker
- **EN ↔ 中文 language toggle** with `localStorage` persistence
- **Dark mode** follows `prefers-color-scheme`
- **Live indicator dot** in the top bar — pulsing green when live,
  amber when paused, red when a fetch fails
- **Pause / resume / refresh-now** controls with a morphing play/pause
  SVG button
- **Zero external dependencies** — no CDN, no font files, no JS
  library; the whole page is ~25KB inline

**CLI:**

```bash
claude247 status-board --plain
# Claude247 Watchdog Dashboard
# Generated: 2026-05-25T...
#
# Release State / Soak Progress / Runtime Health
# Queue / Task State / Recent Signals / GA Gates / Usage
```

**JSON:** http://127.0.0.1:8423/status-board.json

```json
{
  "generated_at": "...",
  "release_state": { "main_sha": "...", "ga_status": "..." },
  "soak":          { "t0": "...", "progress_percent": 38, "result": "PARTIAL" },
  "runtime_health":{ "launchd_loaded": 4, "dispatcher": "healthy", ... },
  "queue":         { "active_tasks": 0, "orphan_commands": 0, ... },
  "signals":       { "new_critical_errors": 0, "alert_storm": false, ... },
  "ga_gates":      { "passed": 18, "total": 19, "recommendation": "..." },
  "usage":         { "runs_total": 0, "active_workers": 0, ... }
}
```

The watchdog reads `M20_SOAK_RESULT.md` to auto-discover the
dispatcher T0; pass `--t0 2026-05-24T21:46Z` to override.

## Status (Python `claude247` — production)

- **`v1.0.0` GA — released 2026-05-25.**
- The first GA release. See [RELEASE_NOTES_GA.md](RELEASE_NOTES_GA.md)
  for the full notes, [GA_GATE.md](GA_GATE.md) for the 19-gate GA
  contract, and [M22_GA_DECISION_REPORT.md](M22_GA_DECISION_REPORT.md)
  for the GA decision record.
- **Soak gate was explicitly waived by the owner** after ~9h 12m of
  healthy soak evidence (4/4 launchd loaded, ~1182 dispatcher idle
  ticks, backup completed, 0 alerts, 0 orphan commands, $0 Anthropic
  worker spend). Final T+24h observation is a post-GA follow-up —
  the watchdog dashboard will auto-flip `soak.result` to `PASS` or
  `FAIL` once wall-clock crosses `2026-05-25T21:46Z`.
- Pre-release history (`alpha.0` → `beta.2`) preserved on GitHub.

## Documentation (Python `claude247`)

- [RELEASE_NOTES_GA.md](RELEASE_NOTES_GA.md) — v1.0.0 release notes
- [GA_GATE.md](GA_GATE.md) — 19-gate GA contract + owner-waiver policy
- [M22_GA_DECISION_REPORT.md](M22_GA_DECISION_REPORT.md) — GA decision record
- [M20_SOAK_RESULT.md](M20_SOAK_RESULT.md) — soak observation + waiver record
- [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) — DoD checklist
- [CHANGELOG.md](CHANGELOG.md) — release history
- `docs/ARCHITECTURE.md` — module map and data flow
- `docs/INSTALL.md` — full install + uninstall + doctor
- `docs/REMOTE_DISPATCH.md` — phone / Remote / Dispatch operating guide
- `docs/SECURITY.md` — secret hygiene, forbidden paths, approval flow
- `docs/MEMORY.md` — vector + .agent file architecture
- `docs/AUTO_MERGE_POLICY.md` — risk scoring and merge gates
- `docs/VALIDATORS.md` — Gemini + OpenAI judge contracts
- `docs/REPO_ONBOARDING.md` — adding repos
- `docs/OPERATIONS.md` — day-to-day operating playbook

---

## Working on the TypeScript control plane (`aedev`)

```bash
# Install dependencies (Node.js ≥ 20, pnpm ≥ 10 required)
pnpm install

# Run all tests
pnpm test

# Type-check across the workspace
pnpm typecheck

# Lint
pnpm lint

# Opt-in real subprocess smoke tests (require `claude` and/or Docker on PATH)
AEDEV_SMOKE_CLAUDE=1 pnpm test --filter @aedev/runner
AEDEV_SMOKE_DOCKER=1 pnpm test --filter @aedev/runner

# Start the daemon (port 7247) — serves the dashboard + REST API
cd packages/daemon && pnpm start
open http://localhost:7247
```

Architecture decisions for `aedev`: [`docs/adr/`](docs/adr/) (ADR-0001 through ADR-0009).

TS runtime parity gates: [`docs/aedev-prototype-status.md`](docs/aedev-prototype-status.md).

---

## License

Internal.
