/** Stage M — schema round-trip test.
 *  Verifies what the scripts/migrate/up + down would do, against the
 *  primitive runMigrations + raw SQL the scripts wrap. */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations, getMigrationVersion } from './migrations.js'

function freshV1Db(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db) // up to current latest (includes v3)
  // simulate "v1 GA" by removing v3
  db.exec('DROP TABLE IF EXISTS event_log')
  db.prepare('DELETE FROM migrations WHERE version = 3').run()
  // insert a fake task chain so backfill has something to do
  db.prepare(`INSERT INTO repos (id,name,path,default_branch,enabled,test_commands,forbidden_paths,risk_rules,merge_policy,created_at,updated_at)
     VALUES ('r1','demo','/tmp/demo','main',1,'[]','[]','{}','WAITING','2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`).run()
  db.prepare(`INSERT INTO missions (id,repo_id,title,status,created_at,updated_at)
     VALUES ('m1','r1','demo-mission','running','2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`).run()
  db.prepare(`INSERT INTO tasks (id,mission_id,repo_id,title,prompt,status,attempt_number,created_at,updated_at)
     VALUES ('t1','m1','r1','demo','do thing','pending',0,'2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`).run()
  return db
}

describe('migrate · v1 → v2.1 → v1 round trip (Stage M L1)', () => {
  it('case 1: fresh v1 db starts without event_log and at version <3', () => {
    const db = freshV1Db()
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'").get() as { name?: string } | undefined
    expect(has).toBeUndefined()
    expect(getMigrationVersion(db)).toBeLessThan(3)
    db.close()
  })

  it('case 2: up (runMigrations) creates event_log additively', () => {
    const db = freshV1Db()
    const tablesBefore = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    runMigrations(db)
    const tablesAfter = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    // every table that existed before still exists
    for (const t of tablesBefore) {
      expect(tablesAfter.find((x) => x.name === t.name)).toBeDefined()
    }
    expect(tablesAfter.find((x) => x.name === 'event_log')).toBeDefined()
    expect(getMigrationVersion(db)).toBe(3)
    db.close()
  })

  it('case 3: down (DROP event_log) restores v1 schema; legacy data intact', () => {
    const db = freshV1Db()
    // seed a row into legacy `events`
    db.prepare(`INSERT INTO events (id,type,entity_type,entity_id,payload,created_at)
       VALUES ('ev_legacy','heartbeat',NULL,NULL,'{}','2026-05-01T00:00:00Z')`).run()
    const beforeCount = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n
    runMigrations(db) // up
    db.exec('DROP TABLE event_log')
    db.prepare('DELETE FROM migrations WHERE version = 3').run()
    // event_log gone:
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'").get() as { name?: string } | undefined
    expect(has).toBeUndefined()
    // legacy data preserved (GROUND RULE 4):
    const afterCount = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n
    expect(afterCount).toBe(beforeCount)
    db.close()
  })

  it('case 4: up is idempotent — re-running yields zero new migration rows', () => {
    const db = freshV1Db()
    runMigrations(db)
    const n1 = (db.prepare('SELECT COUNT(*) AS n FROM migrations').get() as { n: number }).n
    runMigrations(db)
    const n2 = (db.prepare('SELECT COUNT(*) AS n FROM migrations').get() as { n: number }).n
    expect(n2).toBe(n1)
    db.close()
  })

  it('case 5: up enforces event_log UNIQUE idempotency from the migration alone', () => {
    const db = freshV1Db()
    runMigrations(db)
    const insert = db.prepare(`INSERT INTO event_log (id, task_id, ts, actor, kind, idempotency, payload, correlation_id)
                               VALUES (?,?,?,?,?,?,?,?)`)
    insert.run('evt_001', 't1', '2026-05-01T00:00:00Z', 'system', 'task.status.observed', 'sha256:dup', '{}', 't1')
    expect(() =>
      insert.run('evt_002', 't1', '2026-05-01T00:00:00Z', 'system', 'task.status.observed', 'sha256:dup', '{}', 't1'),
    ).toThrow(/UNIQUE/i)
    db.close()
  })
})
