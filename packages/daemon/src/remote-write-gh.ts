/**
 * Real remote-write adapters for the DraftPrGate (P3).
 *
 * GitRemoteWriter  -> `git push` of an already-committed branch.
 * DraftPrCreator   -> `gh pr create --draft` (idempotent: reuses an open PR
 *                     for the same head branch instead of erroring).
 *
 * These only ever run when DraftPrGate is constructed with
 * allowRemoteWrites=true (the safety gate). They never merge.
 *
 * `exec` is injectable so the units are testable without touching git/gh.
 */
import { execFile } from 'child_process'
import type { Repo } from '@aedev/core'
import type { DraftPrCreator, DraftPrInfo, GitRemoteWriter } from './draft-pr-gate.js'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}
export type ExecFn = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<ExecResult>

export const defaultExec: ExecFn = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts?.cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
      resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
    })
  })

export class GhGitRemoteWriter implements GitRemoteWriter {
  constructor(private readonly exec: ExecFn = defaultExec) {}

  async pushBranch(repo: Repo, branch: string, _idempotencyKey: string): Promise<void> {
    // `git push -u origin <branch>` is itself idempotent (re-pushing the same
    // ref is a no-op / fast-forward). The branch must already be committed in
    // repo.path with an `origin` remote pointing at the GitHub repo.
    const r = await this.exec('git', ['-C', repo.path, 'push', '-u', 'origin', branch])
    if (r.code !== 0) throw new Error(`git push failed for ${branch}: ${r.stderr.trim() || r.stdout.trim()}`)
  }
}

export class GhDraftPrCreator implements DraftPrCreator {
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

    // Idempotency: if an open PR already exists for this head, reuse it.
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
