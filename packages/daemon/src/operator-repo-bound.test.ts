import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import type { Repo } from '@aedev/core'
import { createServer } from './server.js'
import { operatorLocalCliRunner } from './routes/operator.js'

// P0 trust fix: the worker must run inside a repo-bound git worktree of the
// operator's selected repo, and an unavailable repo must HOLD — never a silent
// "done" in an empty scratch dir.

let db: AedevDb
let stateDir: string

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aedev-rb-repo-'))
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'test@example.invalid'], dir)
  git(['config', 'user.name', 'test'], dir)
  writeFileSync(join(dir, 'README.md'), '# Fixture\n\nbaseline\n')
  git(['add', '.'], dir)
  git(['commit', '-q', '-m', 'initial'], dir)
  return dir
}

function insertGitRepo(path: string): Repo {
  return db.insertRepo({
    name: 'fixture', path, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    riskRules: {}, mergePolicy: 'WAITING',
  })
}

const PROBE_FLAGS = ['AEDEV_DISABLE_CLAUDE_CLI', 'AEDEV_DISABLE_CODEX_CLI', 'AEDEV_DISABLE_GEMINI_API', 'AEDEV_DISABLE_OPENAI_API'] as const
let savedFlags: Record<string, string | undefined>

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-rb-state-'))
  // Hermetic: skip live worker-session probes (no network, fast) — these tests
  // exercise the repo-binding/preflight logic, not provider discovery.
  savedFlags = {}
  for (const f of PROBE_FLAGS) { savedFlags[f] = process.env[f]; process.env[f] = '1' }
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
  for (const f of PROBE_FLAGS) { if (savedFlags[f] === undefined) delete process.env[f]; else process.env[f] = savedFlags[f] }
})

function markClarifyUnlocked(sessionId: string): void {
  db.insertEvent('clarify.confidence', 'operator_session', sessionId, {
    role: 'planner',
    confidence: 96,
    threshold: 95,
    rationale: 'Test fixture is pre-clarified.',
  })
  db.insertEvent('clarify.unlocked', 'operator_session', sessionId, {
    confidence: 96,
    threshold: 95,
    roundsCompleted: 0,
  })
}

describe('operator repo-bound worker · /start preflight', () => {
  it('HOLDs (not done) when the target repo is not a git repository', async () => {
    const prev = process.env['AEDEV_COCKPIT_FORCE_REAL']
    process.env['AEDEV_COCKPIT_FORCE_REAL'] = '1' // exercise the real path, not the mock runner
    try {
      const app = createServer(db, new Date(), stateDir)
      const repo = db.insertRepo({
        name: 'not-git', path: stateDir, defaultBranch: 'main', enabled: true,
        testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
      })
      const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'approved' })
      const session = db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'approved' })
      markClarifyUnlocked(session.id)

      const res = await app.inject({ method: 'POST', url: `/operator/sessions/${session.id}/start` })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { result: { status: string }; hold: { code: string }; session: { status: string } }
      expect(body.result.status).toBe('blocked')
      expect(body.hold.code).toBe('HOLD-TARGET-REPO-UNAVAILABLE')
      expect(body.session.status).toBe('hold')

      // The mission must NOT be marked done/running — it stays approved and a HOLD exists.
      expect(db.getMission(mission.id)!.status).toBe('approved')
      expect(db.listActiveHolds(mission.id).some((h) => h.code === 'HOLD-TARGET-REPO-UNAVAILABLE')).toBe(true)
      // No worker run was created.
      expect(db.listTasks(mission.id).flatMap((t) => db.listRuns(t.id))).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env['AEDEV_COCKPIT_FORCE_REAL']
      else process.env['AEDEV_COCKPIT_FORCE_REAL'] = prev
    }
  })

  it('flips mission to running and emits run_starting before dispatch (authoritative status)', async () => {
    // Default VITEST = mock runner (fast, awaited); we assert the synchronous
    // pre-dispatch transition happened via the event log.
    const app = createServer(db, new Date(), stateDir)
    const repo = db.insertRepo({
      name: 'mock-repo', path: stateDir, defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'approved' })
    const session = db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'approved' })
    markClarifyUnlocked(session.id)

    const res = await app.inject({ method: 'POST', url: `/operator/sessions/${session.id}/start` })
    expect(res.statusCode).toBe(200)
    expect(db.queryEvents({ type: 'operator.run_starting', entityId: mission.id })).toHaveLength(1)
    // Mission left 'approved' (mock run is awaited under VITEST → terminal).
    expect(db.getMission(mission.id)!.status).not.toBe('approved')
  })
})

describe('operator repo-bound worker · runTask', () => {
  const fakeSession = { id: 's1', provider: 'codex-cli' as const, family: 'openai' as const, healthy: true, active: 0 }
  const fakeClaudeSession = { id: 'claude-1', provider: 'claude-cli' as const, family: 'anthropic' as const, healthy: true, active: 0 }

  function fakeCodex(writes: (workdir: string) => void) {
    return async (_prompt: string, workdir: string) => {
      writes(workdir)
      return {
        transcript: 'worker done', exitCode: 0, durationMs: 5,
        authMode: 'local_codex' as const, costUsd: null, inputTokens: 3, outputTokens: 7, rawJson: {},
      }
    }
  }

  it('runs the worker inside a repo-bound worktree and records the real diff', async () => {
    const repoPath = makeGitRepo()
    try {
      const repo = insertGitRepo(repoPath)
      const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'running' })
      const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 't', prompt: 'add a line to README', status: 'pending', attemptNumber: 1 })

      const runner = operatorLocalCliRunner(db, stateDir, [fakeSession], {
        runCodex: fakeCodex((workdir) => {
          // The worker edits a REAL repo file in its worktree.
          writeFileSync(join(workdir, 'README.md'), '# Fixture\n\nbaseline\nadded by worker\n')
        }),
      })
      const result = await runner.runTask(task)
      expect(result.exitCode).toBe(0)

      // The worktree is repo-bound, not an empty scratch dir.
      const ready = db.queryEvents({ type: 'operator.repo_bound_workspace_ready', entityId: mission.id })
      expect(ready).toHaveLength(1)
      expect(String(ready[0]!.payload['worktreePath'])).toContain(join('operator-workspaces', task.id))
      expect(ready[0]!.payload['repoPath']).toBe(repoPath)

      // The real change is captured in evidence.
      const changed = JSON.parse(readFileSync(join(result.evidenceDir, 'changed-paths.json'), 'utf8')) as { changedPaths: string[]; repoPath: string }
      expect(changed.changedPaths).toContain('README.md')
      expect(changed.repoPath).toBe(repoPath)
      expect(readFileSync(join(result.evidenceDir, 'diff-summary.md'), 'utf8')).toMatch(/README\.md/)

      expect(db.getRun(result.runId)!.status).toBe('done')
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('HOLDs when only Claude is available for local coder work', async () => {
    const repo = db.insertRepo({
      name: 'fixture', path: stateDir, defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'running' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 't', prompt: 'p', status: 'pending', attemptNumber: 1 })
    const runner = operatorLocalCliRunner(db, stateDir, [fakeClaudeSession], { runCodex: fakeCodex(() => undefined) })

    await expect(runner.runTask(task)).rejects.toThrow(/no healthy Codex CLI/)
    expect(db.listRuns(task.id)).toHaveLength(0)
  })

  it('HOLDs (throws) without marking done when the repo is not a git repository', async () => {
    const repo = db.insertRepo({
      name: 'not-git', path: stateDir, defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'running' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 't', prompt: 'p', status: 'pending', attemptNumber: 1 })
    const runner = operatorLocalCliRunner(db, stateDir, [fakeSession], { runCodex: fakeCodex(() => undefined) })

    await expect(runner.runTask(task)).rejects.toThrow(/HOLD-TARGET-REPO-UNAVAILABLE|git repository|worktree/)
    expect(db.listActiveHolds(mission.id).some((h) => h.code === 'HOLD-TARGET-REPO-UNAVAILABLE')).toBe(true)
    expect(db.getTask(task.id)!.status).not.toBe('done')
    expect(existsSync(join(stateDir, 'operator-evidence', task.id))).toBe(true) // evidence dir made, but no fake success
  })
})
