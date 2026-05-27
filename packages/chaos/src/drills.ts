import type { EventLog } from '@aedev/event-log'

export type DrillName =
  | 'kill_worker'
  | 'fill_disk'
  | 'drop_network'
  | 'expire_session'
  | 'sqlite_write_lock'

export interface DrillContext {
  taskId: string
  log: EventLog
  now: () => Date
  /** Set true when running against a real environment; false in unit tests. */
  realEffects?: boolean
}

export interface ChaosDrill {
  name: DrillName
  inject(ctx: DrillContext): Promise<void>
  /** Optional cleanup — runs after the drill window so prod state is restored. */
  cleanup?(ctx: DrillContext): Promise<void>
}

async function emit(ctx: DrillContext, name: DrillName, phase: 'injected' | 'cleaned', detail?: Record<string, unknown>): Promise<string> {
  return ctx.log.append({
    task_id: ctx.taskId,
    ts: ctx.now().toISOString(),
    actor: 'daemon.chaos',
    kind: `chaos.drill.${phase}`,
    payload: { drill: name, detail: detail ?? {} },
    idempotency_source: `${ctx.taskId}|chaos.drill.${phase}|${name}|${ctx.now().toISOString()}`,
  })
}

export const killWorker: ChaosDrill = {
  name: 'kill_worker',
  async inject(ctx) {
    await emit(ctx, this.name, 'injected', { expected_hold_reason: 'session_expired' })
    // Real env would SIGKILL a worker pid here. In unit tests, the event is enough.
    void ctx.realEffects
  },
}

export const fillDisk: ChaosDrill = {
  name: 'fill_disk',
  async inject(ctx) {
    await emit(ctx, this.name, 'injected', { fill_pct: 99 })
  },
  async cleanup(ctx) {
    await emit(ctx, this.name, 'cleaned')
  },
}

export const dropNetwork: ChaosDrill = {
  name: 'drop_network',
  async inject(ctx) {
    await emit(ctx, this.name, 'injected', { duration_s: 30 })
  },
  async cleanup(ctx) {
    await emit(ctx, this.name, 'cleaned')
  },
}

export const expireSession: ChaosDrill = {
  name: 'expire_session',
  async inject(ctx) {
    await emit(ctx, this.name, 'injected', { expected_hold_reason: 'session_expired' })
  },
}

export const sqliteWriteLock: ChaosDrill = {
  name: 'sqlite_write_lock',
  async inject(ctx) {
    await emit(ctx, this.name, 'injected', { lock_seconds: 10 })
  },
  async cleanup(ctx) {
    await emit(ctx, this.name, 'cleaned')
  },
}

export const ALL_DRILLS: readonly ChaosDrill[] = [
  killWorker,
  fillDisk,
  dropNetwork,
  expireSession,
  sqliteWriteLock,
] as const

export const DRILL_BY_NAME: Record<DrillName, ChaosDrill> = {
  kill_worker: killWorker,
  fill_disk: fillDisk,
  drop_network: dropNetwork,
  expire_session: expireSession,
  sqlite_write_lock: sqliteWriteLock,
}
