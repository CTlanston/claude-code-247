import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Task, RunnerConfig, RunResult, RunnerInterface } from '@aedev/core'
import { generateId } from '@aedev/core'
import { Claude247Bridge, type Claude247TaskDetail } from './bridge.js'

/**
 * `RunnerInterface` implementation that delegates execution to the Python
 * `claude247` kernel via `Claude247Bridge`.  Per ADR-0009 and Phase 3 of the
 * dual-kernel migration, this is how an `aedev` mission task can be carried
 * out by the mature Python runtime during the parity window.
 *
 * Lifecycle:
 *   1. Enqueue a task into claude247 via `bridge.enqueue(...)`.  The goal
 *      is prefixed with `[aedev:<taskId>]` so we can correlate the resulting
 *      Python task back to the aedev task that requested it.
 *   2. Poll `bridge.listTasks(...)` until the new Python task is created.
 *   3. Poll `bridge.getTask(...)` until the task reaches a terminal status
 *      (merged, failed, cancelled).
 *   4. Import evidence files from the Python workspace dir into the aedev
 *      evidence dir as `claude247-<filename>`.
 *   5. Return a `RunResult` whose `exitCode` is 0 iff the Python task
 *      reached `merged`, else 1.
 */
export interface Claude247BridgeRunnerOptions {
  /** How often to poll for Python task state (ms).  Default 5000. */
  pollIntervalMs?: number
  /** Time budget to *find* the Python task after enqueue (ms).  Default 120_000. */
  findTimeoutMs?: number
  /** Total time budget for Python task to reach terminal status (ms).  Default 3_600_000 (1h). */
  completeTimeoutMs?: number
  /** Override the goal prefix used for correlation.  Default `[aedev:<taskId>]`. */
  goalPrefix?: (aedevTaskId: string) => string
  /** Injectable sleep — tests use a no-op so polling completes instantly. */
  sleepFn?: (ms: number) => Promise<void>
  /** Terminal statuses (final). */
  terminalStatuses?: Set<string>
}

const DEFAULT_TERMINAL_STATUSES = new Set([
  'merged', 'failed', 'cancelled', 'done',
])
const SUCCESS_STATUSES = new Set(['merged', 'done'])

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class Claude247BridgeRunner implements RunnerInterface {
  private readonly bridge: Claude247Bridge
  private readonly opts: Required<Omit<Claude247BridgeRunnerOptions, 'goalPrefix' | 'sleepFn' | 'terminalStatuses'>> & {
    goalPrefix: (id: string) => string
    sleepFn: (ms: number) => Promise<void>
    terminalStatuses: Set<string>
  }

  constructor(bridge: Claude247Bridge, opts: Claude247BridgeRunnerOptions = {}) {
    this.bridge = bridge
    this.opts = {
      pollIntervalMs: opts.pollIntervalMs ?? 5_000,
      findTimeoutMs: opts.findTimeoutMs ?? 120_000,
      completeTimeoutMs: opts.completeTimeoutMs ?? 3_600_000,
      goalPrefix: opts.goalPrefix ?? ((id: string) => `[aedev:${id}]`),
      sleepFn: opts.sleepFn ?? realSleep,
      terminalStatuses: opts.terminalStatuses ?? DEFAULT_TERMINAL_STATUSES,
    }
  }

  async run(task: Task, config: RunnerConfig): Promise<RunResult> {
    const start = Date.now()
    const runId = generateId()
    const evidenceDir = join(config.outputBaseDir, task.id)
    mkdirSync(evidenceDir, { recursive: true })

    const prefix = this.opts.goalPrefix(task.id)
    const goal = `${prefix} ${task.prompt}`

    // 1. Enqueue
    const enq = await this.bridge.enqueue(task.repoId, goal, {
      source: 'aedev',
      sourceRef: task.id,
    })

    writeBridgeMeta(evidenceDir, {
      bridge: 'claude247',
      aedevTaskId: task.id,
      aedevRunId: runId,
      goalPrefix: prefix,
      commandId: enq.commandId,
      enqueuedAt: enq.queuedAt,
      enqueueStatus: enq.status,
    })

    // 2. Find the resulting Python task by goal prefix
    const findDeadline = Date.now() + this.opts.findTimeoutMs
    let pyTaskId: string | null = null
    while (Date.now() < findDeadline && pyTaskId === null) {
      const tasks = await this.bridge.listTasks({ repoId: task.repoId, limit: 100 })
      const found = tasks.find((t) => t.goal.startsWith(prefix))
      if (found) {
        pyTaskId = found.id
        break
      }
      await this.opts.sleepFn(this.opts.pollIntervalMs)
    }

    if (!pyTaskId) {
      writeBridgeError(evidenceDir, `Failed to locate claude247 task with prefix "${prefix}" within ${this.opts.findTimeoutMs}ms`)
      return { runId, taskId: task.id, exitCode: 1, evidenceDir, durationMs: Date.now() - start }
    }

    writeBridgeMeta(evidenceDir, {
      bridge: 'claude247',
      aedevTaskId: task.id,
      aedevRunId: runId,
      goalPrefix: prefix,
      commandId: enq.commandId,
      enqueuedAt: enq.queuedAt,
      enqueueStatus: enq.status,
      claude247TaskId: pyTaskId,
    })

    // 3. Poll until terminal status
    const completeDeadline = Date.now() + this.opts.completeTimeoutMs
    let lastDetail: Claude247TaskDetail | null = null
    while (Date.now() < completeDeadline) {
      lastDetail = await this.bridge.getTask(pyTaskId)
      if (lastDetail && this.opts.terminalStatuses.has(lastDetail.status)) break
      await this.opts.sleepFn(this.opts.pollIntervalMs)
    }

    // 4. Import evidence
    const ev = await this.bridge.readEvidence(pyTaskId)
    for (const [filename, content] of Object.entries(ev)) {
      writeFileSync(join(evidenceDir, `claude247-${filename}`), content)
    }

    // 5. Final
    const finalStatus = lastDetail?.status ?? 'unknown'
    const exitCode = SUCCESS_STATUSES.has(finalStatus) ? 0 : 1

    writeBridgeFinal(evidenceDir, {
      claude247TaskId: pyTaskId,
      finalStatus,
      finishedAt: lastDetail?.finishedAt ?? null,
      riskScore: lastDetail?.riskScore ?? null,
      eventCount: lastDetail?.events.length ?? 0,
    })

    return { runId, taskId: task.id, exitCode, evidenceDir, durationMs: Date.now() - start }
  }
}

function writeBridgeMeta(evidenceDir: string, meta: Record<string, unknown>): void {
  writeFileSync(join(evidenceDir, 'bridge-meta.json'), JSON.stringify(meta, null, 2))
}

function writeBridgeError(evidenceDir: string, message: string): void {
  writeFileSync(join(evidenceDir, 'bridge-error.txt'), message + '\n')
}

function writeBridgeFinal(evidenceDir: string, payload: Record<string, unknown>): void {
  writeFileSync(join(evidenceDir, 'bridge-final.json'), JSON.stringify(payload, null, 2))
}
