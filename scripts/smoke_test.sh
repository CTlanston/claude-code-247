#!/usr/bin/env bash
# End-to-end smoke for a fresh install:
#   - venv exists
#   - claude247 --help works
#   - claude247 doctor JSON parses
#   - claude247 status JSON parses
#   - pytest passes
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$REPO_ROOT/.venv/bin/python"
BIN="$REPO_ROOT/.venv/bin/claude247"

if [[ ! -x "$BIN" ]]; then
  echo "smoke: venv missing — run 'make install' first" >&2
  exit 2
fi

echo "== claude247 --help =="
"$BIN" --help >/dev/null

echo "== claude247 doctor --json =="
"$BIN" doctor --json | "$PY" -m json.tool >/dev/null || {
  echo "smoke: doctor JSON unparseable" >&2; exit 3;
}

echo "== claude247 status --json =="
"$BIN" status --json | "$PY" -m json.tool >/dev/null

echo "== pytest =="
"$REPO_ROOT/.venv/bin/pytest" -q

echo
echo "smoke: OK"
