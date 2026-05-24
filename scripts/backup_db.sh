#!/usr/bin/env bash
# Snapshot the SQLite state DB via `sqlite3 .backup`. Rotates so we keep
# at most BACKUP_KEEP files (default 14). Idempotent; safe under launchd.
set -Eeuo pipefail

STATE_DIR="${CLAUDE247_STATE_DIR:-$HOME/.claude-code-247/state}"
DB="${CLAUDE247_DB_PATH:-$STATE_DIR/claude247.db}"
BACKUP_DIR="$STATE_DIR/backups"
KEEP="${BACKUP_KEEP:-14}"

if [[ ! -f "$DB" ]]; then
  echo "claude247: backup skipped — db not present at $DB" >&2
  exit 0
fi

mkdir -p "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$BACKUP_DIR/claude247-$ts.db"

# `.backup` uses SQLite's online backup API — safe to run while the DB
# is being written.
sqlite3 "$DB" ".backup '$dest'"

# Rotate: keep newest KEEP files, delete the rest.
# Sort by name (timestamp); ls -1t respects mtime; pick the safer name sort.
to_delete=$(ls -1 "$BACKUP_DIR"/claude247-*.db 2>/dev/null | sort | head -n -"$KEEP" || true)
if [[ -n "$to_delete" ]]; then
  while IFS= read -r f; do
    [[ -n "$f" ]] && rm -f "$f"
  done <<< "$to_delete"
fi

echo "claude247: backed up to $dest"
