import type { Task, RunnerConfig, RunResult } from '@aedev/core'
import { ExperimentalFeatureError } from '@aedev/core'
import type { RunnerInterface } from './runner-interface.js'

export class DockerRunner implements RunnerInterface {
  async isDockerAvailable(): Promise<boolean> {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    try {
      await promisify(execFile)('docker', ['info'], { timeout: 5000 })
      return true
    } catch { return false }
  }

  async run(task: Task, config: RunnerConfig): Promise<RunResult> {
    // config reserved for future Docker implementation
    void config
    if (process.env['AEDEV_DOCKER_RUNNER'] !== '1') {
      throw new ExperimentalFeatureError(
        'DockerRunner',
        'Set AEDEV_DOCKER_RUNNER=1 to enable (prototype only — not production-ready)',
      )
    }
    throw new ExperimentalFeatureError(
      'DockerRunner.run',
      `Task ${task.id}: Docker worker execution requires Phase 5 full release`,
    )
  }
}
