import type { AedevDb, Task, RunnerConfig, RunResult } from '@aedev/core'
import { validateTaskTransition, nowIso } from '@aedev/core'
import { MockRunner } from './mock-runner.js'
import { DockerRunner } from './docker-runner.js'
import type { RunnerInterface } from './runner-interface.js'

export class RunnerManager {
  constructor(
    private db: AedevDb,
    private config: RunnerConfig,
  ) {}

  getRunner(mode: RunnerConfig['mode']): RunnerInterface {
    if (mode === 'mock') return new MockRunner()
    if (mode === 'docker') return new DockerRunner()
    throw new Error(`Unsupported runner mode: ${mode}`)
  }

  async runTask(task: Task): Promise<RunResult> {
    if (task.status !== 'pending') {
      throw new Error(`Task ${task.id} is not in pending state (got: ${task.status})`)
    }
    validateTaskTransition('pending', 'running')
    this.db.updateTaskStatus(task.id, 'running')

    const run = this.db.insertRun({
      taskId: task.id, runnerMode: this.config.mode, status: 'pending',
    })
    this.db.updateRun(run.id, { status: 'running', startedAt: nowIso() })
    this.db.insertEvent('run.started', 'run', run.id, { taskId: task.id })

    let result: RunResult
    try {
      const runner = this.getRunner(this.config.mode)
      result = { ...await runner.run(task, this.config), runId: run.id }
      this.db.updateRun(run.id, { status: 'done', completedAt: nowIso(), exitCode: result.exitCode, evidenceDir: result.evidenceDir })
      validateTaskTransition('running', 'done')
      this.db.updateTaskStatus(task.id, 'done')
      this.db.insertEvent('run.completed', 'run', run.id, { exitCode: result.exitCode })
    } catch (e) {
      this.db.updateRun(run.id, { status: 'failed', completedAt: nowIso(), exitCode: 1, errorMessage: (e as Error).message })
      validateTaskTransition('running', 'failed')
      this.db.updateTaskStatus(task.id, 'failed')
      this.db.insertEvent('run.completed', 'run', run.id, { exitCode: 1, error: (e as Error).message })
      throw e
    }
    return result
  }
}
