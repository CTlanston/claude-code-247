import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface GitClient {
  /** Resolve the commit SHA of the named ref (e.g. 'main'). */
  resolveSha(ref: string): Promise<string>
  /** Run `git revert -m 1 <sha>` and return the new HEAD sha. */
  revertMerge(mergeSha: string, opts?: { reason?: string }): Promise<string>
}

/** Worker-side GitClient implementation that shells out to `git`. */
export class ChildProcessGitClient implements GitClient {
  constructor(private readonly cwd: string) {}

  async resolveSha(ref: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: this.cwd, timeout: 5000 })
    return stdout.trim()
  }

  async revertMerge(mergeSha: string, opts?: { reason?: string }): Promise<string> {
    const reason = opts?.reason ?? `revert merge ${mergeSha}`
    await execFileAsync('git', ['revert', '--no-edit', '-m', '1', mergeSha], { cwd: this.cwd, timeout: 30_000 })
    if (reason) {
      await execFileAsync('git', ['commit', '--amend', '-m', `revert ${mergeSha}\n\n${reason}`], { cwd: this.cwd, timeout: 5000 })
    }
    return this.resolveSha('HEAD')
  }
}
