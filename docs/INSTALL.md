# Install

## Prerequisites

| Tool | Required | Notes |
|---|---|---|
| macOS 14+ | yes | launchd integration assumes a desktop user session |
| Python 3.11+ (3.13 recommended) | yes | `pyproject.toml` declares the floor |
| Docker Desktop | yes (for the `docker` runner backend) | the `local` backend works without it for dev/tests |
| Git | yes | |
| `gh` CLI | yes when PR creation is enabled | `brew install gh && gh auth login` |
| Claude Code CLI | yes for the main worker path | `npm install -g @anthropic-ai/claude-code`; log in |
| ntfy.sh app | optional | for phone notifications |
| Qdrant | optional | only needed when `memory.vector.backend: qdrant` |

## Steps

```bash
git clone <this repo> ~/projects/claude-code-247
cd ~/projects/claude-code-247

# Create the venv, install the package + dev/test extras
make install

# Verify the environment
make doctor
# OR: claude247 doctor --with-claude-smoke   (slow; round-trips through `claude -p`)

# Initialize the runtime tree
mkdir -p ~/.claude-code-247

# Add your first repo
.venv/bin/claude247 repo add

# Optional: install launchd jobs so the dashboard stays up 24/7
scripts/install_launchd.sh

# Open the dashboard
open http://127.0.0.1:8423
```

## Removing

```bash
scripts/uninstall_launchd.sh             # unload jobs, keep plists
scripts/uninstall_launchd.sh --purge     # also delete plists + logs
make clean                                # delete venv + caches
```
