import { describe, it, expect } from 'vitest'
import type { Repo } from '@aedev/core'
import { GhGitRemoteWriter, GhDraftPrCreator, type ExecFn, type ExecResult } from './remote-write-gh.js'
import { DraftPrGate } from './draft-pr-gate.js'

const repo: Repo = {
  id: 'r1', name: 'aedev-p3-smoke', path: '/tmp/clone',
  githubOwner: 'CTlanston', githubRepo: 'aedev-p3-smoke', defaultBranch: 'main',
  enabled: true, testCommands: [], forbiddenPaths: ['.env*', '.github/**'],
  riskRules: {}, mergePolicy: 'WAITING', createdAt: '', updatedAt: '',
}

const ok = (stdout = ''): ExecResult => ({ stdout, stderr: '', code: 0 })
const fail = (stderr = 'boom'): ExecResult => ({ stdout: '', stderr, code: 1 })

function recorder(handler: (cmd: string, args: string[]) => ExecResult): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = []
  const exec: ExecFn = async (cmd, args) => { calls.push([cmd, ...args]); return handler(cmd, args) }
  return { exec, calls }
}

describe('GhGitRemoteWriter', () => {
  it('pushes the branch from repo.path to origin', async () => {
    const { exec, calls } = recorder(() => ok())
    await new GhGitRemoteWriter(exec).pushBranch(repo, 'v3-s0', 'key')
    expect(calls[0]).toEqual(['git', '-C', '/tmp/clone', 'push', '-u', 'origin', 'v3-s0'])
  })

  it('throws when git push fails', async () => {
    const { exec } = recorder(() => fail('rejected'))
    await expect(new GhGitRemoteWriter(exec).pushBranch(repo, 'b', 'key')).rejects.toThrow(/git push failed/)
  })
})

describe('GhDraftPrCreator', () => {
  const draftHandler = (cmd: string, args: string[]): ExecResult => {
    if (args[0] === 'pr' && args[1] === 'list') return ok('[]')
    if (args[0] === 'pr' && args[1] === 'create') return ok('https://github.com/CTlanston/aedev-p3-smoke/pull/1\n')
    if (args[0] === 'pr' && args[1] === 'view') return ok(JSON.stringify({ number: 1, url: 'https://github.com/CTlanston/aedev-p3-smoke/pull/1', state: 'OPEN', isDraft: true }))
    return ok()
  }

  it('creates a draft PR when none exists', async () => {
    const { exec, calls } = recorder(draftHandler)
    const info = await new GhDraftPrCreator(exec).createDraftPr({ repo, title: 't', body: 'b', head: 'v3-s0', base: 'main', idempotencyKey: 'k' })
    expect(info).toEqual({ number: 1, url: 'https://github.com/CTlanston/aedev-p3-smoke/pull/1', state: 'open', draft: true })
    expect(calls.some((c) => c.includes('create'))).toBe(true)
  })

  it('is idempotent: reuses an open PR for the same head without creating', async () => {
    const { exec, calls } = recorder((cmd, args) => {
      if (args[1] === 'list') return ok(JSON.stringify([{ number: 7, url: 'u7', state: 'OPEN', isDraft: true }]))
      return ok()
    })
    const info = await new GhDraftPrCreator(exec).createDraftPr({ repo, title: 't', body: 'b', head: 'v3-s0', base: 'main', idempotencyKey: 'k' })
    expect(info.number).toBe(7)
    expect(calls.some((c) => c.includes('create'))).toBe(false)
  })

  it('rejects a non-draft result (never silently opens a ready PR)', async () => {
    const { exec } = recorder((cmd, args) => {
      if (args[1] === 'list') return ok('[]')
      if (args[1] === 'create') return ok('https://github.com/CTlanston/aedev-p3-smoke/pull/9')
      if (args[1] === 'view') return ok(JSON.stringify({ number: 9, url: 'u9', state: 'OPEN', isDraft: false }))
      return ok()
    })
    await expect(new GhDraftPrCreator(exec).createDraftPr({ repo, title: 't', body: 'b', head: 'h', base: 'main', idempotencyKey: 'k' })).rejects.toThrow(/not a draft/)
  })
})

describe('DraftPrGate with real adapters', () => {
  const req = {
    repo, missionId: 'm1', title: 'P3 smoke', branch: 'v3-s0', base: 'main',
    changedPaths: ['NOTE.md'], evidenceUri: 'e', riskScore: 0, validatorResults: [], rollbackNotes: 'close the PR',
  }

  it('blocks push + PR when allow_remote_writes is false (no exec at all)', async () => {
    const git = recorder(() => ok())
    const pr = recorder(() => ok())
    const gate = new DraftPrGate({ allowRemoteWrites: false }, new GhGitRemoteWriter(git.exec), new GhDraftPrCreator(pr.exec))
    await expect(gate.openDraftPr(req)).rejects.toMatchObject({ code: 'REMOTE_WRITES_DISABLED' })
    expect(git.calls.length).toBe(0)
    expect(pr.calls.length).toBe(0)
  })

  it('pushes then opens a draft PR when allow_remote_writes is true', async () => {
    const handler = (cmd: string, args: string[]): ExecResult => {
      if (cmd === 'git') return ok()
      if (args[1] === 'list') return ok('[]')
      if (args[1] === 'create') return ok('https://github.com/CTlanston/aedev-p3-smoke/pull/2')
      if (args[1] === 'view') return ok(JSON.stringify({ number: 2, url: 'https://github.com/CTlanston/aedev-p3-smoke/pull/2', state: 'OPEN', isDraft: true }))
      return ok()
    }
    const git = recorder(handler)
    const pr = recorder(handler)
    const gate = new DraftPrGate({ allowRemoteWrites: true }, new GhGitRemoteWriter(git.exec), new GhDraftPrCreator(pr.exec))
    const info = await gate.openDraftPr(req)
    expect(info.draft).toBe(true)
    expect(info.number).toBe(2)
    expect(git.calls.some((c) => c[0] === 'git' && c.includes('push'))).toBe(true)
  })
})
