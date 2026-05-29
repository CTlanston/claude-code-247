import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations, getMigrationVersion, MIGRATIONS } from './migrations.js'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
})
afterEach(() => db.close())

describe('migrations (Stage A.2)', () => {
  it('reports current version after running', () => {
    const max = MIGRATIONS[MIGRATIONS.length - 1].version
    expect(getMigrationVersion(db)).toBe(max)
  })

  it('v3 creates event_log with the v2.1 shape', () => {
    const cols = db
      .prepare("PRAGMA table_info(event_log)")
      .all() as { name: string; type: string; notnull: number; pk: number }[]
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]))
    expect(byName['id']?.pk).toBe(1)
    expect(byName['task_id']?.notnull).toBe(1)
    expect(byName['ts']?.notnull).toBe(1)
    expect(byName['actor']?.notnull).toBe(1)
    expect(byName['kind']?.notnull).toBe(1)
    expect(byName['idempotency']?.notnull).toBe(1)
    expect(byName['payload']?.notnull).toBe(1)
    expect(byName['causation_id']).toBeDefined()
    expect(byName['correlation_id']?.notnull).toBe(1)
  })

  it('v3 enforces idempotency UNIQUE on event_log', () => {
    const row = (id: string, idem: string) =>
      db
        .prepare(
          'INSERT INTO event_log (id, task_id, ts, actor, kind, idempotency, payload, correlation_id) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(id, 't1', '2026-05-26T00:00:00.000Z', 'daemon', 'task.status.changed', idem, '{}', 't1')
    row('evt_01ABC', 'sha256:aaaa')
    expect(() => row('evt_01DEF', 'sha256:aaaa')).toThrow(/UNIQUE/i)
  })

  it('preserves the legacy events table (GROUND RULE 4 — schema dual compat)', () => {
    const cols = db
      .prepare("PRAGMA table_info(events)")
      .all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('type')
    expect(names).toContain('entity_type')
    expect(names).toContain('entity_id')
    expect(names).toContain('created_at')
  })

  it('is idempotent — re-running runMigrations is a no-op', () => {
    const before = getMigrationVersion(db)
    runMigrations(db)
    const after = getMigrationVersion(db)
    expect(after).toBe(before)
    const rows = db.prepare('SELECT COUNT(*) AS n FROM migrations').get() as { n: number }
    expect(rows.n).toBe(MIGRATIONS.length)
  })

  it('exposes indexes for the hot query paths (task_id+ts, kind, causation_id)', () => {
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='event_log'")
      .all() as { name: string }[]
    const names = idx.map((r) => r.name)
    expect(names).toContain('idx_event_log_task_ts')
    expect(names).toContain('idx_event_log_kind')
    expect(names).toContain('idx_event_log_causation')
  })

  it('v4 creates additive operator cockpit tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('operator_sessions')
    expect(names).toContain('operator_messages')
    expect(names).toContain('mission_artifacts')
  })
})
