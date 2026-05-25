import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

const exec = promisify(execFile)

export class WorktreeManager {
  constructor(private workspacesDir: string) {
    mkdirSync(workspacesDir, { recursive: true })
  }

  worktreePath(taskId: string): string {
    return join(this.workspacesDir, taskId)
  }

  async createWorktree(repoPath: string, taskId: string, branch: string = 'HEAD'): Promise<string> {
    const wt = this.worktreePath(taskId)
    await exec('git', ['-C', repoPath, 'worktree', 'add', '--detach', wt, branch])
    return wt
  }

  async removeWorktree(repoPath: string, taskId: string): Promise<void> {
    const wt = this.worktreePath(taskId)
    if (existsSync(wt)) {
      await exec('git', ['-C', repoPath, 'worktree', 'remove', '--force', wt])
    }
  }

  async listWorktrees(repoPath: string): Promise<string[]> {
    const { stdout } = await exec('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'])
    return stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))
  }
}
