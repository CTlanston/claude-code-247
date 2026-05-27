import type { EventLog } from '@aedev/event-log'
import { ALL_DRILLS, DRILL_BY_NAME, type ChaosDrill, type DrillContext, type DrillName } from './drills.js'

export interface ChaosInjectorOpts {
  log: EventLog
  taskId?: string
  now?: () => Date
  realEffects?: boolean
}

export class ChaosInjector {
  private readonly log: EventLog
  private readonly defaultTask: string
  private readonly now: () => Date
  private readonly realEffects: boolean

  constructor(opts: ChaosInjectorOpts) {
    this.log = opts.log
    this.defaultTask = opts.taskId ?? 'task_chaos'
    this.now = opts.now ?? (() => new Date())
    this.realEffects = opts.realEffects ?? false
  }

  private ctx(taskId?: string): DrillContext {
    return { taskId: taskId ?? this.defaultTask, log: this.log, now: this.now, realEffects: this.realEffects }
  }

  /** Inject one named drill, run cleanup if any. */
  async runOnce(name: DrillName, taskId?: string): Promise<void> {
    const drill = DRILL_BY_NAME[name]
    const ctx = this.ctx(taskId)
    await drill.inject(ctx)
    if (drill.cleanup) await drill.cleanup(ctx)
  }

  /** Inject every drill in ALL_DRILLS sequentially. */
  async runFullSuite(taskId?: string): Promise<void> {
    for (const d of ALL_DRILLS) {
      const ctx = this.ctx(taskId)
      await d.inject(ctx)
      if (d.cleanup) await d.cleanup(ctx)
    }
  }

  /** Inject a random drill (deterministic when seed provided). */
  async runRandom(seed?: number, taskId?: string): Promise<DrillName> {
    const idx = (seed ?? Math.floor(Math.random() * 1e9)) % ALL_DRILLS.length
    const drill: ChaosDrill = ALL_DRILLS[idx]
    const ctx = this.ctx(taskId)
    await drill.inject(ctx)
    if (drill.cleanup) await drill.cleanup(ctx)
    return drill.name
  }
}
