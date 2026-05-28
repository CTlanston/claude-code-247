import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { AedevDb } from '@aedev/core'
import { MissionIntakeSource } from './mission-intake-source.js'
import { AutonomousIntakeService } from './autonomous-intake.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('AutonomousIntakeService', () => {
  it('materializes execute-now candidates into pending approval missions and keeps proposals as drafts', async () => {
    const db = new AedevDb(':memory:')
    const stateDir = makeTempDir('autonomous-intake-state')
    const repoPath = makeTempDir('autonomous-intake-repo')
    writeFileSync(join(repoPath, 'src.ts'), '// TODO: investigate router fallback\n')
    const repo = db.insertRepo({
      name: 'widget',
      path: repoPath,
      defaultBranch: 'main',
      enabled: true,
      testCommands: ['pnpm test -- --reporter=json'],
      forbiddenPaths: [],
      riskRules: {},
      mergePolicy: 'WAITING',
      githubOwner: 'acme',
      githubRepo: 'widget',
    })

    const service = new AutonomousIntakeService(db, stateDir, {
      sourceFactory: async (_repo, options) => new MissionIntakeSource({
        ...options,
        github: {
          owner: 'acme',
          repo: 'widget',
          repoId: repo.id,
          listIssues: async () => [{
            number: 42,
            title: 'Fix auth token flow',
            body: 'Touches auth',
            url: 'https://github.com/acme/widget/issues/42',
            labels: ['aedev:auto'],
          }],
        },
        failingTests: {
          repoPath,
          repoId: repo.id,
          runCommand: async () => ({
            exitCode: 1,
            stdout: JSON.stringify({
              testResults: [{
                name: 'packages/core/src/router.test.ts',
                assertionResults: [{
                  status: 'failed',
                  title: 'routes coder work',
                  ancestorTitles: ['MissionRunner'],
                  failureMessages: ['expected codex route to be selected'],
                }],
              }],
            }),
            stderr: '',
          }),
        },
      }),
    })

    const result = await service.scan({ repoId: repo.id })

    expect(result.created).toBe(3)
    expect(result.blocked).toBe(0)
    expect(result.overflow).toBe(0)
    expect(result.missions.filter((mission) => mission.missionStatus === 'pending_approval')).toHaveLength(1)
    expect(result.missions.filter((mission) => mission.missionStatus === 'draft')).toHaveLength(2)
    expect(db.listMissions(repo.id)).toHaveLength(3)
  })

  it('deduplicates repeated scans by candidate marker', async () => {
    const db = new AedevDb(':memory:')
    const stateDir = makeTempDir('autonomous-intake-state-dedupe')
    const repoPath = makeTempDir('autonomous-intake-repo-dedupe')
    writeFileSync(join(repoPath, 'src.ts'), 'export const x = 1\n')
    const repo = db.insertRepo({
      name: 'widget',
      path: repoPath,
      defaultBranch: 'main',
      enabled: true,
      testCommands: [],
      forbiddenPaths: [],
      riskRules: {},
      mergePolicy: 'WAITING',
    })

    const service = new AutonomousIntakeService(db, stateDir, {
      sourceFactory: async (_repo, options) => new MissionIntakeSource({
        ...options,
        manual: [{
          id: 'manual-1',
          source: 'manual',
          title: 'Safe manual follow-up',
          body: 'Polish the worker summary evidence.',
          repoId: repo.id,
        }],
      }),
    })

    const first = await service.scan({ repoId: repo.id })
    const second = await service.scan({ repoId: repo.id })

    expect(first.created).toBe(1)
    expect(second.duplicates).toBe(1)
    expect(db.listMissions(repo.id)).toHaveLength(1)
  })

  it('creates a HOLD-FLOOD event when intake exceeds the repo cap', async () => {
    const db = new AedevDb(':memory:')
    const stateDir = makeTempDir('autonomous-intake-state-flood')
    const repoPath = makeTempDir('autonomous-intake-repo-flood')
    const repo = db.insertRepo({
      name: 'widget',
      path: repoPath,
      defaultBranch: 'main',
      enabled: true,
      testCommands: [],
      forbiddenPaths: [],
      riskRules: {},
      mergePolicy: 'WAITING',
    })

    const service = new AutonomousIntakeService(db, stateDir, {
      capPerRepo: 1,
      sourceFactory: async (_repo, options) => new MissionIntakeSource({
        ...options,
        manual: [
          { id: 'manual-1', source: 'manual', title: 'Safe manual follow-up 1', body: 'Polish evidence.', repoId: repo.id },
          { id: 'manual-2', source: 'manual', title: 'Safe manual follow-up 2', body: 'Polish evidence.', repoId: repo.id },
        ],
      }),
    })

    const result = await service.scan({ repoId: repo.id })
    const events = db.queryEvents({ type: 'hold.policy.created', entityId: repo.id })

    expect(result.created).toBe(1)
    expect(result.overflow).toBe(1)
    expect(result.holds[0]?.holdCode).toBe('HOLD-FLOOD')
    expect(events[0]?.payload['holdCode']).toBe('HOLD-FLOOD')
    expect(db.listMissions(repo.id)).toHaveLength(1)
  })
})

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `aedev-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}
