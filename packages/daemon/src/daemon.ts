import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'
import { HeartbeatService } from './heartbeat.js'
import { MissionScheduler } from './mission-scheduler.js'
import { DailySummaryGenerator } from './daily-summary.js'
import { MissionRunner } from './mission-runner.js'
import { discoverWorkerSessions, GhGitRemoteWriter, GhDraftPrCreator } from '@aedev/runner'
import { resolveStateDir } from './paths.js'
import { createDefaultMissionValidatorFactory } from './validator-factory.js'
import { DraftPrGate } from './draft-pr-gate.js'
import { allowRemoteWritesEnabled, remoteWriteWhitelist } from './remote-write-policy.js'
import { recordDiscoveryProbe } from './headless-budget-guard.js'
import { Watchdog } from './watchdog.js'
import { CostRoller } from '@aedev/cost-meter'

export const DEFAULT_PORT = 7247

export interface DaemonConfig {
  dbPath?: string
  port?: number
  /** Where evidence + daily summaries live.  Default: <AEDEV_HOME>/state or ~/.aedev/state. */
  stateDir?: string
  /** Tick interval for the mission scheduler (ms).  Default 60_000. */
  schedulerIntervalMs?: number
  /** When false, the scheduler loop is not started automatically.  Tests pass false. */
  autoStartScheduler?: boolean
  /** When false, the daily-summary writer is not started automatically.  Default true. */
  autoWriteDailySummary?: boolean
  /** Injected sleep — used by tests to drive the scheduler loop instantly. */
  sleepFn?: (ms: number) => Promise<void>
  /** When false, the P3 watchdog loop is not started automatically.  Tests pass false. */
  autoStartWatchdog?: boolean
  /** Watchdog tick cadence in minutes (default 30 / AEDEV_WATCHDOG_TICK_MINUTES). */
  watchdogTickMinutes?: number
}

export class Daemon {
  private db!: AedevDb
  private heartbeat!: HeartbeatService
  private server!: ReturnType<typeof createServer>
  private startTime!: Date
  private scheduler?: MissionScheduler
  private schedulerLoop?: Promise<{ ticks: number; totalDispatched: number }>
  private watchdog?: Watchdog
  private stateDir!: string
  /** Long-lived rolling cost window; injected into every MissionRunner and scraped by /metrics. */
  private readonly costRoller = new CostRoller()

  constructor(private config: DaemonConfig = {}) {}

  async start(): Promise<void> {
    this.startTime = new Date()
    this.db = new AedevDb(this.config.dbPath ?? ':memory:')
    this.heartbeat = new HeartbeatService(this.db, 30_000)
    this.heartbeat.start()

    this.stateDir = this.config.stateDir ?? resolveStateDir()
    mkdirSync(this.stateDir, { recursive: true })

    // Seed the rolling cost window from persisted model_usage (oldest-first to
    // match the roller's in-order assumption) so spend survives a daemon restart.
    for (const u of this.db.listModelUsage().reverse()) {
      if (typeof u.costUsd === 'number' && u.costUsd > 0) {
        this.costRoller.record({ ts: u.createdAt, costUsd: u.costUsd })
      }
    }

    const allowRemoteWrites = allowRemoteWritesEnabled(this.stateDir)
    this.server = createServer(this.db, this.startTime, this.stateDir, {
      draftPrExecutor: new DraftPrGate(
        { allowRemoteWrites, remoteWriteWhitelist: remoteWriteWhitelist(this.stateDir) },
        new GhGitRemoteWriter(),
        new GhDraftPrCreator(),
      ),
    }, this.costRoller)
    await this.server.listen({ port: this.config.port ?? DEFAULT_PORT, host: '127.0.0.1' })

    // Mission scheduler — survives restart because state lives in the events table.
    const schedulerOpts: { tickIntervalMs?: number; sleepFn?: (ms: number) => Promise<void> } = {}
    if (this.config.schedulerIntervalMs !== undefined) schedulerOpts.tickIntervalMs = this.config.schedulerIntervalMs
    if (this.config.sleepFn !== undefined) schedulerOpts.sleepFn = this.config.sleepFn
    this.scheduler = new MissionScheduler(this.db, schedulerOpts)

    const autoStart = this.config.autoStartScheduler ?? true
    if (autoStart) {
      // Run in background; never awaited — stop() cancels it.
      this.schedulerLoop = this.scheduler.runLoop(async (mission) => {
        // Read the safety gate per dispatch (config may change at runtime).  The
        // DraftPrGate itself fail-closes when allow_remote_writes is false, so the
        // autonomous loop opens a real draft PR only when the operator enables it.
        const allowRemoteWrites = allowRemoteWritesEnabled(this.stateDir)
        const workerSessions = await discoverWorkerSessions()
        recordDiscoveryProbe(this.db, null, workerSessions)
        const runner = new MissionRunner(this.db, {
          stateDir: this.stateDir,
          workerSessions,
          validatorFactory: createDefaultMissionValidatorFactory(),
          draftPrExecutor: new DraftPrGate(
            { allowRemoteWrites, remoteWriteWhitelist: remoteWriteWhitelist(this.stateDir) },
            new GhGitRemoteWriter(),
            new GhDraftPrCreator(),
          ),
          costRoller: this.costRoller,
        })
        await runner.runMission(mission.id).catch((e) => {
          this.db.insertEvent('mission.scheduler_dispatch_error', 'mission', mission.id, {
            error: (e as Error).message,
          })
        })
      })
    }

    // P3 watchdog — standby watcher (zero idle LLM calls): notifies on new
    // holds, flags stale running missions, and runs the nightly Memory
    // Compiler. Survives restarts because its window derives from events.
    if (this.config.autoStartWatchdog ?? true) {
      this.watchdog = new Watchdog({
        db: this.db,
        ...(this.config.watchdogTickMinutes !== undefined ? { tickMinutes: this.config.watchdogTickMinutes } : {}),
        ...(this.config.sleepFn !== undefined ? { sleepFn: this.config.sleepFn } : {}),
      })
      this.watchdog.start()
    }

    if (this.config.autoWriteDailySummary !== false) {
      this.writeDailySummary()
    }
  }

  async stop(): Promise<void> {
    this.heartbeat.stop()
    if (this.watchdog) await this.watchdog.stop()
    if (this.scheduler) this.scheduler.stop()
    if (this.schedulerLoop) await this.schedulerLoop
    await this.server.close()
    this.db.close()
  }

  getDb(): AedevDb { return this.db }

  /** Write today's daily summary to <stateDir>/daily-summary/<YYYY-MM-DD>.md. */
  writeDailySummary(date?: string): string {
    const generator = new DailySummaryGenerator(this.db)
    const day = date ?? new Date().toISOString().slice(0, 10)
    const dir = join(this.stateDir, 'daily-summary')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${day}.md`)
    writeFileSync(path, generator.render({ date: day }))
    this.db.insertEvent('daemon.daily_summary_written', 'daemon', day, { path })
    return path
  }

  /** Expose the scheduler so callers can `schedule` / `cancel` missions. */
  getScheduler(): MissionScheduler | undefined { return this.scheduler }
}
