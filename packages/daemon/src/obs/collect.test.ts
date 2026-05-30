import { describe, it, expect } from 'vitest'
import { AedevDb } from '@aedev/core'
import { buildDaemonMetrics, computeDaemonHealth, HEARTBEAT_STALE_SECONDS } from './collect.js'

function seededDb(): AedevDb {
  const db = new AedevDb(':memory:')
  const repo = db.insertRepo({
    name: 'r', path: '/tmp/r', defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
  db.insertMission({ repoId: repo.id, title: 'm1', description: 'd', status: 'approved' })
  db.insertApproval({ entityType: 'mission', entityId: 'x', requiredReason: 'r', status: 'pending' })
  db.insertEvent('hold.policy.created', 'hold', 'h1', { holdId: 'H1' })
  return db
}

describe('obs/collect — real daemon telemetry', () => {
  it('renders Prometheus metrics from live state (no hardcoded values)', () => {
    const db = seededDb()
    const out = buildDaemonMetrics(db, Date.now()).render()
    expect(out).toContain('events_total')
    expect(out).toMatch(/approval_pending 1/)
    expect(out).toMatch(/holds_open 1/)
    expect(out).toMatch(/missions\{status="approved"\} 1/)
    expect(out).toContain('heartbeat_age_seconds -1') // no heartbeat recorded yet
    db.close()
  })

  it('open-holds count drops to 0 once the hold is resolved', () => {
    const db = seededDb()
    db.insertEvent('hold.policy.resolved', 'hold', 'h1', { holdId: 'H1' })
    expect(buildDaemonMetrics(db, Date.now()).render()).toMatch(/holds_open 0/)
    db.close()
  })

  it('health is green on a fresh boot with no heartbeat yet', () => {
    const db = new AedevDb(':memory:')
    expect(computeDaemonHealth(db, Date.now()).status).toBe('green')
    db.close()
  })

  it('health degrades when the heartbeat is stale (scheduler/heartbeat hung)', () => {
    const db = new AedevDb(':memory:')
    db.insertEvent('heartbeat', 'daemon', 'hb', {})
    const insertedAt = Date.now()
    expect(computeDaemonHealth(db, insertedAt).status).toBe('green')
    const future = insertedAt + (HEARTBEAT_STALE_SECONDS + 30) * 1000
    const stale = computeDaemonHealth(db, future)
    expect(stale.status).toBe('degraded')
    expect(stale.checks.heartbeatStale).toBe(true)
    db.close()
  })
})
