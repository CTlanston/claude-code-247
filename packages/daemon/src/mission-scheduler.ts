import type { AedevDb, Mission } from '@aedev/core'

/**
 * Mission-level scheduler for the multi-day autonomy phase.
 *
 * Per the migration plan §multi-day: a mission can be queued with a
 * `scheduledFor` timestamp; the scheduler wakes up periodically and
 * triggers processing for any mission whose time has come.  The scheduler
 * itself is just a clock + a queue — actual mission execution is delegated
 * to a caller-supplied `dispatchFn` so this module stays testable without
 * any runner/role-pipeline wiring.
 *
 * Survives daemon restarts because schedules live in the SQLite events
 * table: a `mission.scheduled` event records the absolute ISO timestamp,
 * and `pendingAt()` reads them back on next boot.
 */
export interface ScheduledMission {
  missionId: string
  scheduledFor: string  // ISO timestamp
  reason?: string
}

export interface SchedulerOptions {
  /** Injectable clock for tests. */
  now?: () => number
  /** Injectable sleep for tests. */
  sleepFn?: (ms: number) => Promise<void>
  /** How often the scheduler wakes when running.  Default 60_000 (60s). */
  tickIntervalMs?: number
}

export type DispatchFn = (mission: Mission) => Promise<void>

export class MissionScheduler {
  private readonly nowFn: () => number
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly tickIntervalMs: number
  private stopRequested = false

  constructor(private readonly db: AedevDb, opts: SchedulerOptions = {}) {
    this.nowFn = opts.now ?? (() => Date.now())
    this.sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.tickIntervalMs = opts.tickIntervalMs ?? 60_000
  }

  /** Schedule a mission to be processed at `whenIso`.  Idempotent per mission. */
  schedule(missionId: string, whenIso: string, reason?: string): void {
    this.db.insertEvent('mission.scheduled', 'mission', missionId, {
      scheduledFor: whenIso,
      reason: reason ?? null,
    })
  }

  /** Cancel any pending schedule for the given mission. */
  cancel(missionId: string): void {
    this.db.insertEvent('mission.unscheduled', 'mission', missionId, {})
  }

  /**
   * Returns missions whose latest schedule event has `scheduledFor` <= now
   * AND has no later `mission.unscheduled` event.  Reads events directly so
   * we survive a daemon restart without an in-memory queue.
   */
  pendingAt(when: Date = new Date(this.nowFn())): ScheduledMission[] {
    const inner = this.db as unknown as { db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } } }
    const rows = inner.db.prepare(`
      SELECT entity_id AS mission_id, payload AS payload, type AS kind, created_at AS at
      FROM events
      WHERE entity_type='mission'
        AND type IN ('mission.scheduled','mission.unscheduled')
      ORDER BY created_at ASC
    `).all() as Array<{ mission_id: string; payload: string; kind: string; at: string }>
    // Build the latest state per mission.
    const latest = new Map<string, { kind: string; payload: { scheduledFor?: string; reason?: string } }>()
    for (const r of rows) {
      let parsed: { scheduledFor?: string; reason?: string }
      try { parsed = JSON.parse(r.payload) as typeof parsed } catch { parsed = {} }
      latest.set(r.mission_id, { kind: r.kind, payload: parsed })
    }
    const pending: ScheduledMission[] = []
    for (const [missionId, st] of latest) {
      if (st.kind !== 'mission.scheduled') continue
      const scheduledFor = st.payload.scheduledFor
      if (!scheduledFor) continue
      if (new Date(scheduledFor).getTime() <= when.getTime()) {
        const item: ScheduledMission = { missionId, scheduledFor }
        if (st.payload.reason) item.reason = st.payload.reason
        pending.push(item)
      }
    }
    return pending
  }

  /**
   * One tick: find pending missions and pass them to the dispatcher.
   * The dispatcher decides what to do (run the role pipeline, kick off a
   * runner, etc.).  After successful dispatch the schedule is cleared via
   * an `mission.unscheduled` event.
   */
  async tick(dispatch: DispatchFn): Promise<{ dispatched: number; errors: Array<{ missionId: string; error: string }> }> {
    const pending = this.pendingAt()
    let dispatched = 0
    const errors: Array<{ missionId: string; error: string }> = []
    for (const p of pending) {
      const inner = this.db as unknown as { getMission(id: string): Mission | null }
      const mission = inner.getMission(p.missionId)
      if (!mission) continue
      try {
        await dispatch(mission)
        this.db.insertEvent('mission.unscheduled', 'mission', p.missionId, { reason: 'dispatched' })
        dispatched++
      } catch (e) {
        errors.push({ missionId: p.missionId, error: (e as Error).message })
      }
    }
    return { dispatched, errors }
  }

  /** Long-running loop.  Stops when `stop()` is called.  Tests pass a fake sleepFn so this completes fast. */
  async runLoop(dispatch: DispatchFn, maxTicks?: number): Promise<{ ticks: number; totalDispatched: number }> {
    let ticks = 0
    let totalDispatched = 0
    while (!this.stopRequested) {
      const out = await this.tick(dispatch)
      totalDispatched += out.dispatched
      ticks++
      if (maxTicks !== undefined && ticks >= maxTicks) break
      await this.sleepFn(this.tickIntervalMs)
    }
    return { ticks, totalDispatched }
  }

  stop(): void {
    this.stopRequested = true
  }
}
