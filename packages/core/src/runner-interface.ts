import type { Task, RunResult, RunnerConfig } from './schema.js'

/**
 * Contract every runner implementation must satisfy.  Lives in core so that
 * downstream packages (e.g. `@aedev/claude247-bridge`) can implement it
 * without creating a circular dependency through `@aedev/runner`.
 */
export interface RunnerInterface {
  run(task: Task, config: RunnerConfig): Promise<RunResult>
}
