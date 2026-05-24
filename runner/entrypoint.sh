#!/usr/bin/env bash
# Runner entrypoint.
#
# The orchestrator launches this with the task spec on stdin (JSON) and
# expects worker exit code 0 on success. We hand control straight to
# worker.py — the shell layer exists only to set HOME / PATH / locale
# defaults that bind-mounted user envs may have stripped.
set -Eeuo pipefail

export HOME="${HOME:-/home/runner}"
export PATH="/opt/claude247/.local/bin:/usr/local/bin:/usr/bin:/bin"
export LANG="${LANG:-C.UTF-8}"

exec python3 -m runner.worker "$@"
