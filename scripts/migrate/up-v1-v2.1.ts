/**
 * Stage M — v1 → v2.1 upgrade script.
 *
 * Usage:
 *   pnpm tsx scripts/migrate/up-v1-v2.1.ts <path-to-claude247.db>
 *
 * Idempotent: re-running on an already-upgraded DB is a no-op.
 *
 * What it does:
 *   1. Runs `runMigrations(db)` — that brings the schema to v3 (adds
 *      event_log + indexes). The migration is additive; the legacy
 *      `events` table and every other v1 table are untouched.
 *   2. Backfills event_log with synthetic events derived from existing
 *      task / mission / approval rows so the reducer has historical
 *      context. This is best-effort — the canonical v2.1 source of
 *      truth is the NDJSON event log (packages/event-log), so this
 *      SQLite mirror is just a query convenience.
 *
 * What it deliberately does NOT do:
 *   - Drop, rename, or alter any v1 column.
 *   - Modify ~/.claude-code-247/state — the operator chooses when to
 *     point the v2.1 daemon at the db path.
 */
import Database from 'better-sqlite3'
import { runMigrations, getMigrationVersion } from '../../packages/core/src/migrations.js'
import { createHash } from 'node:crypto'

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('usage: tsx scripts/migrate/up-v1-v2.1.ts <db-path>')
  process.exit(2)
}

const db = new Database(dbPath)
const versionBefore = getMigrationVersion(db)
runMigrations(db)
const versionAfter = getMigrationVersion(db)
console.log(`[up] migrations: v${versionBefore} → v${versionAfter}`)

// Best-effort backfill: insert synthetic events for existing tasks.
const hash = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex')
type TaskRow = { id: string; status: string; created_at: string; updated_at: string }
const tasks = db.prepare('SELECT id, status, created_at, updated_at FROM tasks').all() as TaskRow[]
const insert = db.prepare(
  'INSERT OR IGNORE INTO event_log (id, task_id, ts, actor, kind, idempotency, payload, causation_id, correlation_id) VALUES (?,?,?,?,?,?,?,?,?)',
)
let inserted = 0
for (const t of tasks) {
  const id = `evt_v1mig${t.id.padEnd(20, '0').slice(0, 20)}`
  const kind = 'task.status.observed'
  const payload = JSON.stringify({ from: 'v1-backfill', status: t.status })
  const idemp = hash(`v1mig|${t.id}|${kind}|${t.status}`)
  const r = insert.run(id, t.id, t.updated_at ?? t.created_at, 'system.v1-migration', kind, idemp, payload, null, t.id)
  if (r.changes > 0) inserted += 1
}
console.log(`[up] backfilled ${inserted} event_log rows from ${tasks.length} tasks`)
db.close()
process.exit(0)
