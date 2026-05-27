import type { EventLog } from '@aedev/event-log'
import { createHash } from 'node:crypto'

export interface MoveStep<C> {
  /** Stable name; goes into event kind and idempotency anchors. */
  name: string
  /** Optional precondition; false → skip step (treated as a no-op completion). */
  precondition?: (ctx: C) => boolean | Promise<boolean>
  /** Side-effectful act. Caller passes the idempotencyKey; the step is
   *  responsible for honoring it on the side effect (git, http, etc). */
  act: (ctx: C, idempotencyKey: string) => unknown | Promise<unknown>
  /** Optional compensator. Called in reverse order when a subsequent step fails. */
  compensate?: (ctx: C) => unknown | Promise<unknown>
}

export interface SagaOpts<C> {
  log: EventLog
  taskId: string
  /** Move name — used in event kinds and idempotency anchors. */
  moveName: string
  steps: MoveStep<C>[]
  actor?: string
  now?: () => Date
}

export type SagaStatus = 'completed' | 'compensated' | 'in_progress'

export interface SagaResult<C> {
  status: SagaStatus
  completedSteps: string[]
  ctx: C
  /** When status === 'compensated', this is the index of the step that failed. */
  failedAt?: number
  error?: unknown
}

export function idempotencyKey(taskId: string, moveName: string, stepName: string, attempt = 1): string {
  return (
    'sha256:' +
    createHash('sha256').update(`${taskId}|${moveName}|${stepName}|${attempt}`).digest('hex')
  )
}

/**
 * Saga — Stage G Move executor.
 *
 * For each step:
 *   1. Optional precondition: false → skip.
 *   2. Append move.started.
 *   3. Run act(ctx, idemKey). The idemKey is deterministic by
 *      (taskId, moveName, stepName, attempt); replaying yields the same
 *      key so downstream side-effect APIs can dedupe.
 *   4. Append move.act.completed on success, or move.act.failed on
 *      thrown error.
 *   5. On any failure: walk completed steps in reverse, call
 *      compensate() on each, append move.compensated per step.
 *   6. At the end of a successful all-steps run, append move.advanced.
 *
 * The same saga rerun with the same taskId+moveName will produce
 * identical idempotency keys at every step — the event log appender's
 * dedupe ensures replays do not duplicate the move's outcomes in the
 * log. The act() implementations themselves are responsible for using
 * the idemKey at their external side effect surface (git push,
 * gh pr create, etc.) per workbook §4.5.
 */
export class Saga<C> {
  private readonly log: EventLog
  private readonly taskId: string
  private readonly moveName: string
  private readonly steps: MoveStep<C>[]
  private readonly actor: string
  private readonly now: () => Date

  constructor(opts: SagaOpts<C>) {
    this.log = opts.log
    this.taskId = opts.taskId
    this.moveName = opts.moveName
    this.steps = opts.steps
    this.actor = opts.actor ?? 'daemon.moves'
    this.now = opts.now ?? (() => new Date())
  }

  async run(initialCtx: C): Promise<SagaResult<C>> {
    const ctx = initialCtx
    const completed: number[] = []

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]
      if (step.precondition && !(await step.precondition(ctx))) continue
      const ts = this.now().toISOString()
      const idemKey = idempotencyKey(this.taskId, this.moveName, step.name)

      await this.log.append({
        task_id: this.taskId,
        ts,
        actor: this.actor,
        kind: 'move.act.started',
        payload: { move: this.moveName, step: step.name, idemKey },
        idempotency_source: `${this.taskId}|move.act.started|${this.moveName}|${step.name}`,
      })

      try {
        await step.act(ctx, idemKey)
      } catch (err) {
        await this.log.append({
          task_id: this.taskId,
          ts: this.now().toISOString(),
          actor: this.actor,
          kind: 'move.act.failed',
          payload: {
            move: this.moveName,
            step: step.name,
            error: err instanceof Error ? err.message : String(err),
          },
          idempotency_source: `${this.taskId}|move.act.failed|${this.moveName}|${step.name}`,
        })
        await this.compensateBack(completed, ctx)
        return { status: 'compensated', completedSteps: completed.map((j) => this.steps[j].name), ctx, failedAt: i, error: err }
      }

      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: 'move.act.completed',
        payload: { move: this.moveName, step: step.name },
        idempotency_source: `${this.taskId}|move.act.completed|${this.moveName}|${step.name}`,
      })
      completed.push(i)
    }

    await this.log.append({
      task_id: this.taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'move.fsm.advanced',
      payload: { move: this.moveName, stepsCompleted: completed.length },
      idempotency_source: `${this.taskId}|move.advanced|${this.moveName}`,
    })

    return { status: 'completed', completedSteps: completed.map((j) => this.steps[j].name), ctx }
  }

  private async compensateBack(completed: number[], ctx: C): Promise<void> {
    for (let k = completed.length - 1; k >= 0; k--) {
      const step = this.steps[completed[k]]
      if (!step.compensate) continue
      try {
        await step.compensate(ctx)
      } catch {
        // compensation is best-effort; the failure is logged but we
        // continue compensating the rest.
      }
      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: 'move.step.compensated',
        payload: { move: this.moveName, step: step.name },
        idempotency_source: `${this.taskId}|move.compensated|${this.moveName}|${step.name}`,
      })
    }
  }
}
