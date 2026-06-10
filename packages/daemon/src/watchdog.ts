/** WORKBOOK_v4 P3 — 24/7 watchdog: a standby watcher, not a token burner.
 *
 * The daemon ticks on a cadence (default 30 min). Each tick is ZERO LLM
 * calls — it only reads the event store and pushes notifications when
 * something actionable changed:
 *
 *  - holds created since the last tick → one ntfy per hold (hold-on-blocker
 *    protocol, GR via `watchdog.hold_notified` events)
 *  - missions stuck in `running` with no activity past the stale window →
 *    one ntfy per mission, deduped forever via `watchdog.stale_notified`
 *  - nightly Memory Compiler: once per calendar day, at/after the configured
 *    hour, Tier-2 lessons are compiled into each repo's Tier-1 memory file
 *    (fixes the v3-P5 deviation where compilation only ran at Gemini-block
 *    time)
 *
 * Every tick appends a `watchdog.tick` event; the "since last tick" window
 * is derived from that event, so the watchdog itself is event-sourced and
 * restart-safe (GR#5). Quiet tick → no notification, no LLM call.
 */
import type { AedevDb } from '@aedev/core'
import { compileTier2LessonsToTier1, projectTier2Lessons } from '@aedev/memory'
import { sendNtfy } from './ntfy.js'

export const WATCHDOG_TICK_EVENT = 'watchdog.tick'
export const HOLD_EVENT_TYPES = ['operator.hold_created', 'mission.run_held'] as const

export interface WatchdogTickReport {
  ts: string
  newHoldsNotified: number
  staleMissionsNotified: number
  memoryCompiledRepos: number
  quiet: boolean
}

export interface WatchdogOptions {
  db: AedevDb
  /** Tick cadence in minutes (env AEDEV_WATCHDOG_TICK_MINUTES, default 30). */
  tickMinutes?: number
  /** Hour of day (local) at/after which the nightly compile runs (env AEDEV_WATCHDOG_COMPILE_HOUR, default 2). */
  compileHour?: number
  /** A `running` mission with no events for this many minutes is stale (env AEDEV_WATCHDOG_STALE_MINUTES, default 45). */
  staleMinutes?: number
  /** Injected clock/sleep for tests. */
  now?: () => Date
  sleepFn?: (ms: number) => Promise<void>
  /** Injected notifier — defaults to ntfy. Tests inject a recorder. */
  notify?: (title: string, body: string) => Promise<unknown>
  /** Home dir for the operator-prefs Tier-1 file (tests pass a temp dir). */
  homeDir?: string
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export class Watchdog {
  private readonly db: AedevDb
  private readonly now: () => Date
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly notify: (title: string, body: string) => Promise<unknown>
  private running = false
  private loop?: Promise<void>
  private stopSignal?: Promise<void>
  private stopResolve?: () => void

  constructor(private readonly opts: WatchdogOptions) {
    this.db = opts.db
    this.now = opts.now ?? (() => new Date())
    this.sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.notify = opts.notify ?? ((title, body) => sendNtfy(title, body, 'high'))
  }

  tickMinutes(): number { return this.opts.tickMinutes ?? envInt('AEDEV_WATCHDOG_TICK_MINUTES', 30) }
  private compileHour(): number { return this.opts.compileHour ?? envInt('AEDEV_WATCHDOG_COMPILE_HOUR', 2) }
  private staleMinutes(): number { return this.opts.staleMinutes ?? envInt('AEDEV_WATCHDOG_STALE_MINUTES', 45) }

  start(): void {
    if (this.running) return
    this.running = true
    this.stopSignal = new Promise((resolve) => { this.stopResolve = resolve })
    this.loop = (async () => {
      while (this.running) {
        // The stop signal interrupts the sleep so daemon shutdown never
        // waits out a 30-minute tick window.
        await Promise.race([this.sleepFn(this.tickMinutes() * 60_000), this.stopSignal])
        if (!this.running) break
        try {
          await this.tick()
        } catch (e) {
          this.db.insertEvent('watchdog.tick_error', undefined, undefined, { error: (e as Error).message })
        }
      }
    })()
  }

  async stop(): Promise<void> {
    this.running = false
    this.stopResolve?.()
    await this.loop?.catch(() => undefined)
  }

  /** One watchdog pass. Zero LLM calls by construction. */
  async tick(): Promise<WatchdogTickReport> {
    const now = this.now()
    const nowIso = now.toISOString()
    const lastTick = this.db.queryEvents({ type: WATCHDOG_TICK_EVENT, limit: 1 })[0]?.createdAt

    const newHoldsNotified = await this.notifyNewHolds(lastTick === undefined)
    const staleMissionsNotified = await this.notifyStaleMissions(now)
    const memoryCompiledRepos = this.compileNightlyMemory(now)

    const report: WatchdogTickReport = {
      ts: nowIso,
      newHoldsNotified,
      staleMissionsNotified,
      memoryCompiledRepos,
      quiet: newHoldsNotified === 0 && staleMissionsNotified === 0 && memoryCompiledRepos === 0,
    }
    this.db.insertEvent(WATCHDOG_TICK_EVENT, undefined, undefined, { ...report })
    return report
  }

  /** Hold events not yet seen by the watchdog → one notification each,
   *  deduped forever via `watchdog.hold_notified` keyed by the source event
   *  id (timestamp-independent, so same-millisecond bursts and restarts are
   *  safe). The very first tick marks pre-existing holds as seen WITHOUT
   *  notifying, so historical holds are never re-blasted. */
  private async notifyNewHolds(firstTick: boolean): Promise<number> {
    const seen = new Set(
      this.db.queryEvents({ type: 'watchdog.hold_notified' })
        .map((e) => e.payload['sourceEventId'])
        .filter((id): id is string => typeof id === 'string'),
    )
    let notified = 0
    for (const type of HOLD_EVENT_TYPES) {
      for (const event of this.db.queryEvents({ type })) {
        if (seen.has(event.id)) continue
        const code = typeof event.payload['holdCode'] === 'string' ? event.payload['holdCode'] : 'HOLD'
        const reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : ''
        if (!firstTick) {
          await this.notify(`aedev ${code}`, `${code} on ${event.entityType ?? 'system'} ${event.entityId ?? ''}: ${reason}`.trim())
          notified += 1
        }
        this.db.insertEvent('watchdog.hold_notified', event.entityType, event.entityId, {
          holdCode: code, sourceEventId: event.id, suppressed: firstTick,
        })
      }
    }
    return notified
  }

  /** `running` missions with no event activity inside the stale window →
   *  notify once per mission (deduped forever via watchdog.stale_notified). */
  private async notifyStaleMissions(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.staleMinutes() * 60_000).toISOString()
    let notified = 0
    for (const mission of this.db.listMissions()) {
      if (mission.status !== 'running') continue
      const lastEvent = this.db.queryEvents({ entityId: mission.id, limit: 1 })[0]?.createdAt ?? mission.createdAt
      if (lastEvent > cutoff) continue
      const already = this.db.queryEvents({ type: 'watchdog.stale_notified', entityId: mission.id, limit: 1 }).length > 0
      if (already) continue
      await this.notify('aedev stale mission', `Mission ${mission.id} (${mission.title}) has been running with no activity since ${lastEvent}.`)
      this.db.insertEvent('watchdog.stale_notified', 'mission', mission.id, { lastEvent, staleMinutes: this.staleMinutes() })
      notified += 1
    }
    return notified
  }

  /** Nightly Tier-2 → Tier-1 Memory Compiler: once per calendar day, at or
   *  after compileHour. Returns the number of repos compiled. */
  private compileNightlyMemory(now: Date): number {
    if (now.getHours() < this.compileHour()) return 0
    const today = localDateString(now)
    const last = this.db.queryEvents({ type: 'watchdog.memory_compiled', limit: 1 })[0]
    if (last && typeof last.payload['day'] === 'string' && last.payload['day'] === today) return 0
    let compiled = 0
    for (const repo of this.db.listRepos()) {
      try {
        compileTier2LessonsToTier1(repo, projectTier2Lessons(this.db, { repoId: repo.id }), this.opts.homeDir)
        compiled += 1
      } catch (e) {
        this.db.insertEvent('watchdog.memory_compile_error', 'repo', repo.id, { error: (e as Error).message })
      }
    }
    this.db.insertEvent('watchdog.memory_compiled', undefined, undefined, { day: today, repos: compiled })
    return compiled
  }
}

function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
