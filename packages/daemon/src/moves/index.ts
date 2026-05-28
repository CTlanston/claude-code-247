import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { AedevDb } from '@aedev/core'

export interface BoundedMove<C> {
  id: string
  title: string
  tokenBudget?: number
  timeoutMs?: number
  run: (ctx: C, idempotencyKey: string) => Promise<C>
}

export interface MoveRunnerOpts {
  db: AedevDb
  taskId: string
  evidenceDir: string
  defaultTimeoutMs?: number
  now?: () => Date
}

export interface MoveRunResult<C> {
  ctx: C
  completed: string[]
  skipped: string[]
  failed?: { id: string; error: string }
}

export class BoundedMoveRunner<C> {
  private readonly defaultTimeoutMs: number
  private readonly now: () => Date

  constructor(private readonly opts: MoveRunnerOpts) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 10 * 60 * 1000
    this.now = opts.now ?? (() => new Date())
  }

  recoverCompleted(): Set<string> {
    const events = this.opts.db.queryEvents({ entityId: this.opts.taskId })
    return new Set(
      events
        .filter((event) => event.type === 'move.completed')
        .map((event) => String(event.payload['moveId'])),
    )
  }

  async run(initialCtx: C, moves: readonly BoundedMove<C>[]): Promise<MoveRunResult<C>> {
    mkdirSync(this.opts.evidenceDir, { recursive: true })
    const alreadyDone = this.recoverCompleted()
    const completed: string[] = []
    const skipped: string[] = []
    let ctx = initialCtx

    for (const move of moves) {
      if (alreadyDone.has(move.id)) {
        skipped.push(move.id)
        continue
      }
      const idempotencyKey = moveIdempotencyKey(this.opts.taskId, move.id)
      const startedAt = this.now().toISOString()
      this.opts.db.insertEvent('move.started', 'task', this.opts.taskId, {
        moveId: move.id,
        title: move.title,
        tokenBudget: move.tokenBudget ?? null,
        idempotencyKey,
      })

      try {
        ctx = await withTimeout(move.run(ctx, idempotencyKey), move.timeoutMs ?? this.defaultTimeoutMs, move.id)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        this.opts.db.insertEvent('move.failed', 'task', this.opts.taskId, { moveId: move.id, error })
        this.writeManifest({ completed, skipped, failed: { id: move.id, error } })
        return { ctx, completed, skipped, failed: { id: move.id, error } }
      }

      const completedAt = this.now().toISOString()
      this.opts.db.insertEvent('move.completed', 'task', this.opts.taskId, {
        moveId: move.id,
        startedAt,
        completedAt,
        idempotencyKey,
      })
      completed.push(move.id)
      this.writeWorkerSummary(move.id, { startedAt, completedAt, idempotencyKey })
    }

    this.writeManifest({ completed, skipped })
    return { ctx, completed, skipped }
  }

  private writeWorkerSummary(moveId: string, data: Record<string, unknown>): void {
    const dir = join(this.opts.evidenceDir, 'moves')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${moveId}.json`), JSON.stringify(data, null, 2))
  }

  private writeManifest(data: Record<string, unknown>): void {
    writeFileSync(join(this.opts.evidenceDir, 'move-manifest.json'), JSON.stringify(data, null, 2))
  }
}

export function moveIdempotencyKey(taskId: string, moveId: string): string {
  return `sha256:${createHash('sha256').update(`${taskId}|${moveId}`).digest('hex')}`
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, moveId: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`move ${moveId} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
