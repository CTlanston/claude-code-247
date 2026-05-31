import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Repo } from '@aedev/core'
import {
  TARGET_REPO_HOLD,
  TargetRepoUnavailableError,
  collectWorkspaceDiff,
  createRepoBoundWorkspace,
  validateTargetRepo,
} from './operator-workspace.js'

// Repo-bound workspace runs against a REAL temp git repo (git is available in CI),
// so the isolation is proven end-to-end with no stubbing.

let stateDir: string
let repoPath: string

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aedev-ws-repo-'))
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'test@example.invalid'], dir)
  git(['config', 'user.name', 'test'], dir)
  writeFileSync(join(dir, 'README.md'), '# Fixture\n\nline one\n')
  git(['add', '.'], dir)
  git(['commit', '-q', '-m', 'initial'], dir)
  return dir
}

function repoFor(path: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'r1', name: 'fixture', path, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    riskRules: {}, mergePolicy: 'WAITING', createdAt: '', updatedAt: '', ...overrides,
  }
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-ws-state-'))
  repoPath = makeGitRepo()
})
afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(repoPath, { recursive: true, force: true })
})

describe('operator-workspace · validateTargetRepo', () => {
  it('accepts an enabled on-disk git repo with commits', async () => {
    const res = await validateTargetRepo(repoFor(repoPath))
    expect(res.ok).toBe(true)
  })

  it('rejects a missing repo', async () => {
    const res = await validateTargetRepo(undefined)
    expect(res).toMatchObject({ ok: false, code: TARGET_REPO_HOLD })
  })

  it('rejects a disabled repo', async () => {
    const res = await validateTargetRepo(repoFor(repoPath, { enabled: false }))
    expect(res).toMatchObject({ ok: false, code: TARGET_REPO_HOLD })
    if (!res.ok) expect(res.reason).toMatch(/disabled/)
  })

  it('rejects a non-git directory (HOLD, never silent success)', async () => {
    const notGit = mkdtempSync(join(tmpdir(), 'aedev-ws-notgit-'))
    try {
      const res = await validateTargetRepo(repoFor(notGit))
      expect(res).toMatchObject({ ok: false, code: TARGET_REPO_HOLD })
      if (!res.ok) expect(res.reason).toMatch(/not a git repository/)
    } finally {
      rmSync(notGit, { recursive: true, force: true })
    }
  })

  it('rejects a non-existent path', async () => {
    const res = await validateTargetRepo(repoFor(join(stateDir, 'does-not-exist')))
    expect(res).toMatchObject({ ok: false, code: TARGET_REPO_HOLD })
  })
})

describe('operator-workspace · createRepoBoundWorkspace', () => {
  it('creates an isolated git worktree of the repo (not an empty scratch dir)', async () => {
    const ws = await createRepoBoundWorkspace(repoFor(repoPath), 'task-1', stateDir)
    expect(ws.worktreePath).toContain(join('operator-workspaces', 'task-1'))
    expect(existsSync(join(ws.worktreePath, '.git'))).toBe(true)
    // The repo's real files are present in the worktree (proves it is repo-bound).
    expect(readFileSync(join(ws.worktreePath, 'README.md'), 'utf8')).toMatch(/line one/)
    expect(ws.baseSha).toMatch(/^[0-9a-f]{7,}/)
  })

  it('throws TargetRepoUnavailableError for a non-git repo', async () => {
    const notGit = mkdtempSync(join(tmpdir(), 'aedev-ws-notgit2-'))
    try {
      await expect(createRepoBoundWorkspace(repoFor(notGit), 't', stateDir)).rejects.toBeInstanceOf(TargetRepoUnavailableError)
    } finally {
      rmSync(notGit, { recursive: true, force: true })
    }
  })

  it('reports a dirty source working tree', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Fixture\n\nedited uncommitted\n')
    const ws = await createRepoBoundWorkspace(repoFor(repoPath), 'task-dirty', stateDir)
    expect(ws.dirty).toBe(true)
    // Worker runs on committed HEAD, so the operator's uncommitted WIP is NOT in the worktree.
    expect(readFileSync(join(ws.worktreePath, 'README.md'), 'utf8')).toMatch(/line one/)
  })
})

describe('operator-workspace · collectWorkspaceDiff', () => {
  it('reports the worker’s real repository changes', async () => {
    const ws = await createRepoBoundWorkspace(repoFor(repoPath), 'task-2', stateDir)
    // Simulate worker edits inside the worktree.
    writeFileSync(join(ws.worktreePath, 'README.md'), '# Fixture\n\nline one\nline two added by worker\n')
    writeFileSync(join(ws.worktreePath, 'NOTES.md'), 'new file\n')
    const diff = await collectWorkspaceDiff(ws.worktreePath, ws.baseSha, repoFor(repoPath).forbiddenPaths)
    expect(diff.changedPaths).toContain('README.md')
    expect(diff.changedPaths).toContain('NOTES.md')
    expect(diff.forbiddenHits).toHaveLength(0)
    expect(diff.summary).toMatch(/non-empty diff is the expected success signal/)
  })

  it('flags forbidden-path hits', async () => {
    const ws = await createRepoBoundWorkspace(repoFor(repoPath), 'task-3', stateDir)
    writeFileSync(join(ws.worktreePath, '.env'), 'SECRET=should-not-touch\n')
    const diff = await collectWorkspaceDiff(ws.worktreePath, ws.baseSha, repoFor(repoPath).forbiddenPaths)
    expect(diff.forbiddenHits).toContain('.env')
  })
})
