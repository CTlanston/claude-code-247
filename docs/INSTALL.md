# Install

The runtime is a **TypeScript daemon** (Fastify + dashboard) on **port 7247**,
run under launchd. (The earlier Python `claude247` / port-8423 flow is retired —
see `docs/aedev-prototype-status.md` for the parity history.)

## Prerequisites

| Tool | Required | Notes |
|---|---|---|
| macOS 14+ | yes | launchd integration assumes a desktop user session |
| Node 20+ | yes | the daemon + scripts run on Node ≥ 20 |
| pnpm 10+ | yes | `npm install -g pnpm` |
| Git | yes | |
| Claude Code CLI (`claude`) | yes for planning | `npm install -g @anthropic-ai/claude-code`; then log in |
| Codex CLI (`codex`) | yes for coding | local subscription worker path |
| Docker Desktop | optional | only for the Docker worker sandbox (not the default path) |
| `gh` CLI | optional | needed later for the remote-write/draft-PR path (P3) |
| Gemini / OpenAI API keys | optional | enable the dual external validators; absent ⇒ `not_configured` (never treated as pass) |
| ntfy.sh app | optional | phone notifications |

## Steps

```bash
git clone <this repo> ~/projects/claude-code-247
cd ~/projects/claude-code-247

pnpm install
pnpm typecheck
pnpm test

# Environment check (node/pnpm/deps + daemon/worker presence)
bash scripts/doctor.sh

# Install the 24/7 daemon as a launchd user agent (port 7247)
bash scripts/install_launchd.sh

# Verify it is up
curl -fsS http://127.0.0.1:7247/health      # -> {"status":"green"}
open http://127.0.0.1:7247                   # dashboard / Operator Cockpit
```

Runtime state lives under `AEDEV_HOME` (the launchd job sets it to
`~/.claude-code-247/aedev-daemon`; the code default when unset is `~/.aedev`):

```
$AEDEV_HOME/
  state.db               SQLite state (tasks, missions, runs, events, ...)
  state/                 evidence bundles + daily summaries
  logs/daemon.{out,err}.log
```

## Removing

```bash
bash scripts/uninstall_launchd.sh            # unload the job, keep plist + state
bash scripts/uninstall_launchd.sh --purge    # also delete the plist + logs (state DB kept)
```

## Safety default

`system.allow_remote_writes` defaults to **false** — the daemon will not `git
push`, create PRs, or merge until you explicitly enable it *and* the repo is
`enabled` in the registry. Keep it off until the remote-write path (plan stage
P3) is wired and validated against a disposable repo.
