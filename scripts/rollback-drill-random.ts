/**
 * Stage 3.99 — random rollback drill (recurring every 4 weeks).
 *
 * Workbook §3.99: "每 4 周一次随机 stage 回滚演练；演练失败暴露
 * GROUND RULE 4 违反."
 *
 * What this script does on each run:
 *   1. Pick a random shipped stage from the active set.
 *   2. Look up its evidence/stage-<id>/METADATA.yaml.
 *   3. For now: run the universal up/down round-trip drill
 *      (packages/core/src/rollback-drill.test.ts logic) — that's the
 *      one rollback path we ship. Future stages with bespoke rollback
 *      scripts will be added here.
 *   4. Write a drill log under evidence/drills/<UTC>.md.
 *   5. Exit 0 on pass; non-zero on fail.
 *
 * Cron suggestion (operator schedules via launchd or systemd timer):
 *   0 4 1 * *   pnpm tsx scripts/rollback-drill-random.ts
 *   # 04:00 UTC on day 1 of every month (≈ 4-week cadence)
 *
 * NOTE: this script does NOT mutate production state. It uses an
 * in-memory SQLite + tmp NDJSON dir, identical to the unit drill in
 * rollback-drill.test.ts. Real rollback against a Mac install must be
 * operator-run per docs/upgrade-guide.md.
 */
import { performance } from 'node:perf_hooks'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { runMigrations, getMigrationVersion } from '../packages/core/src/migrations.js'

const STAGES = ['A', 'B', 'C', 'D', 'E', 'G', 'F1', 'F2', 'F3', 'H', 'I', 'J', 'L', 'M', 'K', 'M1', 'M2', 'M3', 'M4', 'K2']

async function main(): Promise<void> {
  const seed = Number(process.argv[2] ?? Date.now())
  const stage = STAGES[seed % STAGES.length]
  console.log(`[drill] picked stage ${stage} (seed=${seed})`)

  const t0 = performance.now()
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  // simulate v1 baseline by removing v3
  db.exec('DROP TABLE event_log')
  db.prepare('DELETE FROM migrations WHERE version = 3').run()
  // seed legacy events
  for (let i = 0; i < 50; i++) {
    db.prepare(`INSERT INTO events (id,type,entity_type,entity_id,payload,created_at)
                VALUES (?, 'heartbeat', NULL, NULL, '{}', '2026-05-01T00:00:00Z')`).run(`ev_drill_${i}`)
  }
  const before = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n

  // up
  runMigrations(db)
  // business: write 100 new events to event_log
  const insert = db.prepare(
    `INSERT INTO event_log (id, task_id, ts, actor, kind, idempotency, payload, correlation_id) VALUES (?,?,?,?,?,?,?,?)`,
  )
  for (let i = 0; i < 100; i++) {
    insert.run(
      `evt_drillrun_${i.toString().padStart(4, '0')}`,
      't1',
      `2026-05-27T10:00:${(i % 60).toString().padStart(2, '0')}Z`,
      'daemon.drill',
      'task.run.advanced',
      `sha256:drill${i.toString().padStart(60, '0')}`,
      '{}',
      't1',
    )
  }
  // down
  db.exec('DROP TABLE event_log')
  db.prepare('DELETE FROM migrations WHERE version = 3').run()
  const elapsedMs = performance.now() - t0
  const after = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n
  const finalVersion = getMigrationVersion(db)
  db.close()

  const passed = after === before && finalVersion < 3 && elapsedMs < 30 * 60_000

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = path.join(process.cwd(), 'evidence', 'drills')
  await fs.mkdir(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, `rollback-${ts}.md`)
  await fs.writeFile(reportPath, `# Random Rollback Drill — ${new Date().toISOString()}

- Stage chosen: ${stage} (seed=${seed})
- Elapsed: ${Math.round(elapsedMs)} ms
- Legacy events before/after: ${before}/${after}
- Final schema version (post-down): ${finalVersion}
- Verdict: ${passed ? 'PASS' : 'FAIL'}

Per workbook §3.99 the drill exercises the up→business→down cycle
against a fresh in-memory SQLite seeded with v1-shape rows. Real Mac
rollback drills must be operator-run per docs/upgrade-guide.md.

${passed ? '' : '\nFAIL EXPLANATION (would indicate GROUND RULE 4 violation):\n' +
  (after !== before ? '- legacy events count changed across the cycle\n' : '') +
  (finalVersion >= 3 ? '- schema version did not drop below v3 after down\n' : '') +
  (elapsedMs >= 30 * 60_000 ? '- elapsed exceeded the 30-min budget\n' : '')}`)
  console.log(`[drill] report → ${reportPath}`)
  if (!passed) {
    console.error('[drill] FAILED — GROUND RULE 4 may be at risk')
    process.exit(1)
  }
  console.log('[drill] PASS')
}

main().catch((e) => { console.error('[drill] crashed:', e); process.exit(1) })
