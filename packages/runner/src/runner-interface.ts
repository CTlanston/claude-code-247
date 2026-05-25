import type { Task, RunResult, RunnerConfig } from '@aedev/core'

export interface RunnerInterface {
  run(task: Task, config: RunnerConfig): Promise<RunResult>
}
