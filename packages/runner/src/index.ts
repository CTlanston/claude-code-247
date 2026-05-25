/** Worker runner for isolated task execution. */

/** Execution mode for the worker runner. */
export type RunnerMode = 'docker' | 'local' | 'mock'

/** Configuration for the runner. */
export interface RunnerConfig {
  mode: RunnerMode
  maxConcurrentWorkers: number
  worktreeBaseDir: string
  outputBaseDir: string
}

/** Result produced by a completed worker run. */
export interface RunResult {
  runId: string
  taskId: string
  exitCode: number
  evidenceDir: string
  durationMs: number
}
