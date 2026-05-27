/**
 * Stage M — v2.1 → v1 rollback script.
 *
 * Usage:
 *   pnpm tsx scripts/migrate/down-v1-v2.1.ts <path-to-claude247.db> --confirm
 *
 * The --confirm flag is mandatory because dropping event_log is
 * destructive (GROUND RULE 7). Without it, the script prints what it
 * would do and exits non-zero.
 *
 * What it does (with --confirm):
 *   1. DROP TABLE event_log
 *   2. Remove the v3 migration row so re-applying `runMigrations`
 *      re-creates the schema cleanly.
 *
 * The legacy v1 tables (repos, missions, tasks, runs, approvals,
 * memory_items, events, ...) are NOT touched. Down is a v3 schema
 * removal, not a data deletion.
 */
import Database from 'better-sqlite3'

const dbPath = process.argv[2]
const confirm = process.argv.includes('--confirm')
if (!dbPath) {
  console.error('usage: tsx scripts/migrate/down-v1-v2.1.ts <db-path> --confirm')
  process.exit(2)
}

const db = new Database(dbPath)
const has = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'")
  .get() as { name?: string } | undefined
if (!has) {
  console.log('[down] event_log not present; nothing to roll back')
  db.close()
  process.exit(0)
}
if (!confirm) {
  console.log('[down] DRY RUN — would DROP TABLE event_log; pass --confirm to execute')
  db.close()
  process.exit(1)
}
db.exec('DROP TABLE event_log')
db.prepare('DELETE FROM migrations WHERE version = 3').run()
console.log('[down] event_log dropped; migration row removed; v1 schema restored')
db.close()
process.exit(0)
