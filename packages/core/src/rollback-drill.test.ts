/** Stage M L3 rollback drill (compressed, programmatic).
 *
 * Workbook §3 Stage M L3: operator simulates "K+3 漏洞 → 30 分钟回到 v1".
 * That literal drill is a human procedure against a real Mac install.
 * This test runs the same logical sequence in-memory against a fresh
 * SQLite + temp NDJSON dir and asserts:
 *  - Up + business activity + down round-trips < 5 seconds (way under
 *    the 30-min budget).
 *  - Legacy `events` row count unchanged across the cycle.
 *  - event_log NDJSON shards are untouched by the SQLite down (they
 *    live outside SQLite, by ADR-0010).
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { performance } from 'node:perf_hooks'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { runMigrations, getMigrationVersion } from './migrations.js'

function rollbackToLegacyV1(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS mission_artifacts;
    DROP TABLE IF EXISTS operator_messages;
    DROP TABLE IF EXISTS operator_sessions;
    DROP TABLE IF EXISTS event_log;
  `)
  db.prepare('DELETE FROM migrations WHERE version >= 3').run()
}

async function freshV1WithSeedData(): Promise<{ db: Database.Database; eventsBefore: number }> {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  rollbackToLegacyV1(db)
  db.prepare(`INSERT INTO repos (id,name,path,default_branch,enabled,test_commands,forbidden_paths,risk_rules,merge_policy,created_at,updated_at)
              VALUES ('r1','demo','/tmp/demo','main',1,'[]','[]','{}','WAITING','2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`).run()
  db.prepare(`INSERT INTO missions (id,repo_id,title,status,created_at,updated_at)
              VALUES ('m1','r1','demo','running','2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`).run()
  db.prepare(`INSERT INTO tasks (id,mission_id,repo_id,title,prompt,status,attempt_number,created_at,updated_at)
              VALUES ('t1','m1','r1','demo','do thing','pending',0,'2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`).run()
  // pre-seed legacy events
  for (let i = 0; i < 100; i++) {
    db.prepare(`INSERT INTO events (id,type,entity_type,entity_id,payload,created_at)
                VALUES (?, 'heartbeat', NULL, NULL, '{}', ?)`).run(`ev_legacy_${i}`, '2026-05-01T00:00:00Z')
  }
  const n = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n
  return { db, eventsBefore: n }
}

describe('migrate · rollback drill (Stage M L3 compressed)', () => {
  it('case 1: up + business activity + down completes in well under the 30-min budget', () => {
    const promise = freshV1WithSeedData()
    return promise.then(({ db, eventsBefore }) => {
      const start = performance.now()
      runMigrations(db)
      // simulate business activity: write 50 events to event_log
      const insert = db.prepare(`INSERT INTO event_log (id, task_id, ts, actor, kind, idempotency, payload, correlation_id)
                                 VALUES (?,?,?,?,?,?,?,?)`)
      for (let i = 0; i < 50; i++) {
        insert.run(
          `evt_drill_${i.toString().padStart(4, '0')}`,
          't1',
          `2026-05-27T10:00:${(i % 60).toString().padStart(2, '0')}Z`,
          'daemon.drill',
          'task.run.advanced',
          `sha256:drill${i.toString().padStart(60, '0')}`,
          '{}',
          't1',
        )
      }
      // rollback
      rollbackToLegacyV1(db)
      const elapsedMs = performance.now() - start
      const eventsAfter = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n
      const v = getMigrationVersion(db)
      expect(elapsedMs).toBeLessThan(5000)
      expect(eventsAfter).toBe(eventsBefore)
      expect(v).toBeLessThan(3)
      db.close()
    })
  })

  it('case 2: NDJSON event log shards are independent of SQLite rollback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rollback-drill-'))
    const ndjsonPath = path.join(dir, 'events-2026-05.ndjson')
    await fs.writeFile(ndjsonPath, `{"id":"evt_test","task_id":"t1","ts":"2026-05-27T00:00:00.000Z","actor":"daemon","kind":"task.run.advanced","idempotency":"sha256:${'a'.repeat(64)}","payload":{},"correlation_id":"t1"}\n`, 'utf8')
    const before = await fs.stat(ndjsonPath)
    const { db } = await freshV1WithSeedData()
    runMigrations(db)
    rollbackToLegacyV1(db)
    db.close()
    const after = await fs.stat(ndjsonPath)
    expect(after.size).toBe(before.size)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('case 3: drill reports a sub-second budget for the SQLite half', () => {
    const promise = freshV1WithSeedData()
    return promise.then(({ db }) => {
      const upStart = performance.now()
      runMigrations(db)
      const upMs = performance.now() - upStart
      const downStart = performance.now()
      rollbackToLegacyV1(db)
      const downMs = performance.now() - downStart
      expect(upMs).toBeLessThan(1000)
      expect(downMs).toBeLessThan(1000)
      db.close()
    })
  })
})
