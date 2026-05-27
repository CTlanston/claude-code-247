# Upgrade Guide · v1.0 → v2.1

> **Audience:** operators (lanston). This document is the procedure
> Stage M ships as workbook §3 Stage M's "upgrade-guide.md".

## Prerequisites

- A clean working tree on the v2-foundation branch (or a release tag).
- A backup of `~/.claude-code-247/state/claude247.db` (the v1 GA db file).
- The daemon is **stopped**. Confirm with:
  ```sh
  pgrep -lf claude247 || echo "no daemon running"
  ```

## Up (v1 → v2.1)

```sh
cp ~/.claude-code-247/state/claude247.db /tmp/claude247.v1.bak
pnpm tsx scripts/migrate/up-v1-v2.1.ts ~/.claude-code-247/state/claude247.db
```

Expected output:

```
[up] migrations: vX → v3
[up] backfilled N event_log rows from M tasks
```

This is **additive**: every v1 table is preserved. If you point the v1
daemon back at this file, it still works.

## Verify

```sh
sqlite3 ~/.claude-code-247/state/claude247.db \
  "SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'"
```

Should print `event_log`.

```sh
sqlite3 ~/.claude-code-247/state/claude247.db \
  "SELECT COUNT(*) FROM events"
```

The legacy `events` table count must equal the pre-upgrade count.

## Down (v2.1 → v1) — only if something is wrong

```sh
# Dry run first to see what would happen
pnpm tsx scripts/migrate/down-v1-v2.1.ts ~/.claude-code-247/state/claude247.db
# Then, if the dry run says what you expect:
pnpm tsx scripts/migrate/down-v1-v2.1.ts ~/.claude-code-247/state/claude247.db --confirm
```

Down drops `event_log` and removes its migration row. The legacy
schema is restored. Re-running `up` is then safe.

## Feature flag

Set `daemon.legacy_mode: true` in `~/.claude-code-247/config.yaml` to
have the v2.1 daemon write to v1-style tables for one release window.
Removing the flag (or setting it `false`) flips writes to the
event_log-first / view-second pattern from ADR-0010.

```yaml
daemon:
  legacy_mode: false   # default — v2.1 writes events first, views second
```

## Operator sign-off

- [ ] Confirmed pre-upgrade backup exists at /tmp/claude247.v1.bak
- [ ] `up` script printed `migrations: ... → v3`
- [ ] event_log table exists; legacy events table count unchanged
- [ ] Daemon restarted cleanly (`pnpm typecheck && pnpm vitest` green)
- [ ] Verified a synthetic task can be created end-to-end

## Rollback drill (workbook §3 Stage M L3)

The procedure above doubles as the rollback drill. After running up,
make any v2.1-only change you can verify (e.g., emit a few events to
the NDJSON log), then run down --confirm and confirm:

1. `event_log` row is absent
2. NDJSON shards on disk are untouched (they're outside SQLite)
3. v1 daemon can boot against the file

If any step fails, file an incident report at
`evidence/stage-M/incidents/<date>.md` and pause the cutover.
