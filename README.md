# claude-code-247

> Your local-first, multi-repo, 24/7 autonomous coding coworker. The Mac
> stays on; Claude Code authenticated locally drives Docker-isolated
> workers across every repo in your registry, opens draft PRs on GitHub,
> runs external validators, scores risk, and merges low-risk changes
> automatically — gated by your phone if anything bigger.

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

```bash
# 1. Install the package and CLI
make install                    # creates venv + installs deps + launchd plists

# 2. Check the environment
claude247 doctor

# 3. Add your first repo (CLI wizard)
claude247 repo add

# 4. Open the dashboard
open http://localhost:8423                # or http://localhost:8423/status-board

# 5. Kick off a task
claude247 start --repo my-repo --goal "refactor the auth middleware"

# 6. Anytime, anywhere — read-only watchdog
claude247 status-board --plain            # text dashboard for phones
claude247 watchdog --plain                # same command, friendlier alias
claude247 status-board --json             # machine-readable
claude247 status-board --write-md M22_WATCHDOG_DASHBOARD.md
```

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

## Status

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

## Documentation

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

## License

Internal.
