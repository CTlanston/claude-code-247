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

  it('v7 adds a nullable operator_id column to events (v5-P1 operator identity)', () => {
    const cols = db
      .prepare('PRAGMA table_info(events)')
      .all() as { name: string; notnull: number }[]
    const op = cols.find((c) => c.name === 'operator_id')
    expect(op).toBeDefined()
    expect(op?.notnull).toBe(0)
  })

  it('v7 re-applies safely when the column already exists (round-trip guard)', () => {
    // Simulate the Stage M rollback pattern: the migration row is deleted but
    // the ALTERed column survives. Re-running must not throw "duplicate column".
    db.prepare('DELETE FROM migrations WHERE version >= 7').run()
    expect(() => runMigrations(db)).not.toThrow()
    expect(getMigrationVersion(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
  })

  it('v8 creates fleet_workers and fleet_nonces (v5-P2 BYO worker fleet)', () => {
    const workerCols = db.prepare('PRAGMA table_info(fleet_workers)').all() as { name: string; notnull: number; pk: number }[]
    const byName = Object.fromEntries(workerCols.map((c) => [c.name, c]))
    expect(byName['worker_id']?.pk).toBe(1)
    expect(byName['operator_id']?.notnull).toBe(1)
    expect(byName['public_key']?.notnull).toBe(1)
    expect(byName['status']?.notnull).toBe(1)
    expect(byName['last_seen_at']).toBeDefined()
    expect(byName['registered_at']?.notnull).toBe(1)

    const nonceCols = db.prepare('PRAGMA table_info(fleet_nonces)').all() as { name: string }[]
    const nonceNames = nonceCols.map((c) => c.name)
    expect(nonceNames).toContain('worker_id')
    expect(nonceNames).toContain('nonce')
    expect(nonceNames).toContain('endpoint')
    expect(nonceNames).toContain('response_json')
  })

  it('v8 enforces the (worker_id, nonce) idempotency key on fleet_nonces', () => {
    const insert = () =>
      db.prepare('INSERT INTO fleet_nonces (worker_id, nonce, endpoint, created_at) VALUES (?,?,?,?)')
        .run('w1', 'n1', '/fleet/claim', '2026-06-10T00:00:00.000Z')
    insert()
    expect(() => insert()).toThrow(/UNIQUE|PRIMARY/i)
  })

  it('v8 re-applies safely when the tables already exist (round-trip guard, like v7)', () => {
    db.prepare('DELETE FROM migrations WHERE version >= 8').run()
    expect(() => runMigrations(db)).not.toThrow()
    expect(getMigrationVersion(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
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
