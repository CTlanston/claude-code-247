## v1.0.0-beta.0 — Beta-readiness milestone

Four-phase hardening (M18-P0..P4) on top of [v1.0.0-alpha.1](https://github.com/CTlanston/claude-code-247/releases/tag/v1.0.0-alpha.1). M18 explicitly avoided new features; the goal was to move the product from "alpha harness" to "beta-ready live-ops" by hardening auth, validators, daemon, webhooks, and proving a clean second end-to-end on a real GitHub repo.

See [BETA_READINESS_REPORT.md](https://github.com/CTlanston/claude-code-247/blob/claude247/v1/BETA_READINESS_REPORT.md) for the full synthesis.

## Phases shipped

| Phase | Title | Commit |
|---|---|---|
| M18-P0 | Subscription/local auth — `worker_mode` + no silent ANTHROPIC API fallback | `334ed46` |
| M18-P1 | Real OpenAI validator + **mock-cannot-silently-pass-auto-merge** gate | `9dacd5d` |
| M18-P2 | launchd hardening — `doctor_launchd.sh` + extended `doctor` fields + plist tests | `712a639` |
| M18-P3 | Live ngrok webhook validation + explicit `handle_ping` | `5170197` |
| M18-P4 | Second real E2E proving reduced API spend + cleaner auto-merge path | `d50949f` |

## Validated against CTlanston/auto-evo-playground (P4)

Real task: `normalize_whitespace(text)` queued via `claude247 start`, dispatched, role-loop ran, tests passed, PR opened (#53 draft), Gemini judged, merge policy routed to `WAITING_APPROVAL`.

| Item | Value |
|---|---|
| claude-code-247 tag commit | `d50949f` |
| pytest | **419** passing |
| Worker auth mode | `local_claude_code` (subscription CLI) |
| Anthropic API spend | **$0.00** (down from ~$1.50 in alpha.1 for similar-shape task) |
| Gemini verdict | `NEEDS_HUMAN` (honest — see Finding 1 below) |
| OpenAI verdict | `openai-mock` (no key in env-loader scope — see Finding 2) |
| Merge decision | `WAITING_APPROVAL` (mock validator gate held correctly) |

## What "beta-ready" means here

The documented product works end-to-end on a real GitHub repository, the auth path is honest about what it spends, validators are honest about what they ran with, the daemon path is inspectable, and live webhook delivery has been observed. It does **not** mean every backlog item is closed.

## Mocked vs real

| Component | Mode |
|---|---|
| Claude Code worker | **real** (subscription, local CLI) |
| Gemini 2.5 Pro | **real** |
| OpenAI validator | mock (env-loader CWD scope — see Finding 2) |
| GitHub push + PR | **real** |
| Auto-merge | not exercised (validator gate correctly held) |
| Webhook receiver | **real** (P3 live ngrok delivery; 200 OK, signature verified) |
| Qdrant | sqlite-fts fallback |
| Docker runner | local subprocess (daemon offline) |

## Non-blocking backlog filed against beta.0

These were surfaced by the P4 live run and are filed as follow-up. They do not block the tag and are being addressed in the next milestone.

- **BR-001** — `JudgeInput` includes `diff_summary.md` (stat) but not the textual diff body. Real validators correctly refuse to verify byte-identical preservation without seeing the body. (caps real-validator PASS rate)
- **BR-002** — `env_loader.load()` reads `~/.claude-code-247/.env` only; project/CWD `.env` is ignored, so a `OPENAI_API_KEY` in the active shell runs as mock. (config UX)
- **BR-003** — Dispatcher `worker_exit` summary lacks phase/classification/stderr detail, making post-mortem of failed runs harder than it should be. (observability)

## Intentionally not in scope for beta

- Multi-machine HA — single-Mac is by design.
- Cross-org auth — the product is local-first; one user, one machine.
- Docker runner outside dev mode — local backend covers the stated 24/7 single-Mac scope.
- Dashboard auth — it binds to `127.0.0.1` deliberately.

## Pre-release

This is a **pre-release**. Production-ready (`v1.0.0`) is gated on the backlog items above being closed and a clean third E2E with real validators returning a real `PASS`.
