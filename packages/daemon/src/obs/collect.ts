/**
 * Real daemon telemetry collectors, backed by the obs/ PromRegistry.
 *
 * These replace the hardcoded /metrics and /health stubs that used to live in
 * routes/smoke.ts: every series and every health signal here is derived from
 * live SQLite state, so an operator scraping /metrics or polling /health gets
 * the actual system condition.
 */
import type { AedevDb } from '@aedev/core'
import { PromRegistry } from './metrics.js'

/** A heartbeat older than this is treated as stale (3x the 30s heartbeat tick). */
export const HEARTBEAT_STALE_SECONDS = 90

/** Seconds since the last daemon heartbeat event; null when none recorded yet. */
export function heartbeatAgeSeconds(db: AedevDb, nowMs: number): number | null {
  const last = db.queryEvents({ type: 'heartbeat', limit: 1 })[0]?.createdAt
  if (!last) return null
  return Math.max(0, Math.floor((nowMs - new Date(last).getTime()) / 1000))
}

/** Open HOLDs = hold.policy.created events not matched by a hold.policy.resolved. */
export function openHoldsCount(db: AedevDb): number {
  const resolved = new Set(
    db.queryEvents({ type: 'hold.policy.resolved', limit: 1000 })
      .map((e) => String(e.payload['holdId'] ?? e.entityId)),
  )
  return db.queryEvents({ type: 'hold.policy.created', limit: 1000 })
    .filter((e) => !resolved.has(String(e.payload['holdId'] ?? e.entityId)))
    .length
}

/**
 * Build a Prometheus registry populated entirely from live daemon state.
 * Every emitted series carries a real value — there are no placeholder gauges.
 * The events_total line preserves the latest-event-id label the launch-smoke
 * telemetry check relies on.
 */
export function buildDaemonMetrics(db: AedevDb, nowMs: number): PromRegistry {
  const reg = new PromRegistry()
  reg.counter('events_total', 'Daemon events in the recent window, labelled with the latest event id')
  reg.gauge('holds_open', 'Currently-open HOLDs across all entities')
  reg.gauge('approval_pending', 'Currently-pending approvals')
  reg.gauge('heartbeat_age_seconds', 'Seconds since the last daemon heartbeat (-1 = none recorded yet)')
  reg.gauge('missions', 'Missions by status')

  const recent = db.queryEvents({ limit: 1000 })
  reg.inc('events_total', { latest_event_id: recent[0]?.id ?? 'none' }, recent.length)
  reg.set('holds_open', openHoldsCount(db))
  reg.set('approval_pending', db.listApprovals('pending').length)
  reg.set('heartbeat_age_seconds', heartbeatAgeSeconds(db, nowMs) ?? -1)

  const byStatus = new Map<string, number>()
  for (const m of db.listMissions()) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1)
  for (const [status, count] of byStatus) reg.set('missions', count, { status })

  return reg
}

export type HealthStatus = 'green' | 'degraded' | 'red'

export interface DaemonHealth {
  status: HealthStatus
  heartbeatAgeSeconds: number | null
  holdsOpen: number
  pendingApprovals: number
  checks: { db: boolean; heartbeatStale: boolean }
}

/**
 * Real health from live state: red if the DB is unreadable, degraded if the
 * heartbeat is stale (the scheduler/heartbeat loop has hung), else green. A
 * not-yet-written heartbeat (fresh boot) is not "stale".
 */
export function computeDaemonHealth(db: AedevDb, nowMs: number): DaemonHealth {
  try {
    const pendingApprovals = db.listApprovals('pending').length
    const holdsOpen = openHoldsCount(db)
    const age = heartbeatAgeSeconds(db, nowMs)
    const heartbeatStale = age !== null && age > HEARTBEAT_STALE_SECONDS
    return {
      status: heartbeatStale ? 'degraded' : 'green',
      heartbeatAgeSeconds: age,
      holdsOpen,
      pendingApprovals,
      checks: { db: true, heartbeatStale },
    }
  } catch {
    return {
      status: 'red',
      heartbeatAgeSeconds: null,
      holdsOpen: 0,
      pendingApprovals: 0,
      checks: { db: false, heartbeatStale: false },
    }
  }
}
