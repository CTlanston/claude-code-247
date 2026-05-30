/**
 * Worker-side remote-write adapters for the DraftPrGate.
 *
 * These adapters shell out to `git` and `gh`, so they intentionally live in
 * the runner/side-effect plane rather than the daemon package.
 */
import { execFile } from 'child_process'
import type { Repo } from '@aedev/core'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

export type ExecFn = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<ExecResult>

export interface DraftPrInfo {
  number: number
  url: string
  state: string
  draft: true
}

export const defaultExec: ExecFn = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts?.cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
      resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
    })
  })

export class GhGitRemoteWriter {
  constructor(private readonly exec: ExecFn = defaultExec) {}

  async pushBranch(repo: Repo, branch: string, idempotencyKey: string): Promise<void> {
    void idempotencyKey
    const r = await this.exec('git', ['-C', repo.path, 'push', '-u', 'origin', branch])
    if (r.code !== 0) throw new Error(`git push failed for ${branch}: ${r.stderr.trim() || r.stdout.trim()}`)
  }
}

export class GhDraftPrCreator {
  constructor(private readonly exec: ExecFn = defaultExec) {}

  async createDraftPr(req: {
    repo: Repo
    title: string
    body: string
    head: string
    base: string
    idempotencyKey: string
  }): Promise<DraftPrInfo> {
    const slug = `${req.repo.githubOwner}/${req.repo.githubRepo}`

    const existing = await this.exec('gh', ['pr', 'list', '--repo', slug, '--head', req.head, '--state', 'open', '--json', 'number,url,state,isDraft'])
    if (existing.code === 0 && existing.stdout.trim()) {
      const arr = JSON.parse(existing.stdout) as Array<{ number: number; url: string; state: string; isDraft: boolean }>
      if (arr[0]) return { number: arr[0].number, url: arr[0].url, state: arr[0].state.toLowerCase(), draft: true }
    }

    const created = await this.exec('gh', [
      'pr', 'create', '--repo', slug, '--draft',
      '--head', req.head, '--base', req.base,
      '--title', req.title, '--body', req.body,
    ])
    if (created.code !== 0) throw new Error(`gh pr create failed: ${created.stderr.trim() || created.stdout.trim()}`)

    const url = created.stdout.trim().split('\n').filter(Boolean).pop() ?? ''
    const view = await this.exec('gh', ['pr', 'view', url, '--json', 'number,url,state,isDraft'])
    if (view.code !== 0) throw new Error(`gh pr view failed: ${view.stderr.trim() || view.stdout.trim()}`)
    const j = JSON.parse(view.stdout) as { number: number; url: string; state: string; isDraft: boolean }
    if (!j.isDraft) throw new Error(`created PR #${j.number} is not a draft`)
    return { number: j.number, url: j.url, state: j.state.toLowerCase(), draft: true }
  }
}
