import { execFile } from 'child_process'
import { promisify } from 'util'
import { ExperimentalFeatureError } from '@aedev/core'

const exec = promisify(execFile)

export class ClaudeCodeAdapter {
  async isAvailable(): Promise<boolean> {
    try { await exec('which', ['claude']); return true }
    catch { return false }
  }

  async run(prompt: string, workdir: string): Promise<{ transcript: string; exitCode: number }> {
    // Parameters reserved for future implementation
    void prompt; void workdir
    throw new ExperimentalFeatureError(
      'ClaudeCodeAdapter.run',
      'Claude Code subprocess invocation requires Phase 5 full release',
    )
  }
}
