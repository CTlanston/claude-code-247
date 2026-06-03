import { mkdtempSync, rmSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { AedevDb } from '@aedev/core'
import {
  buildMemoryContext,
  compileTier2LessonsToTier1,
  projectTier2Lessons,
  repoTier1MemoryPath,
} from './index.js'

let tmp: string | undefined

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('memory Tier 1 + Tier 2 compiler', () => {
  it('replays a Gemini rejection into repo memory and future worker context', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'aedev-memory-'))
    const db = new AedevDb(':memory:')
    try {
      const repoPath = join(tmp, 'repo')
      const homeDir = join(tmp, 'home')
      const repo = db.insertRepo({
        name: 'memory-repo',
        path: repoPath,
        defaultBranch: 'main',
        enabled: true,
        testCommands: [],
        forbiddenPaths: ['.env*', 'secrets/**', 'AGENTS.md'],
        riskRules: {},
        mergePolicy: 'WAITING',
      })
      const mission = db.insertMission({
        repoId: repo.id,
        title: 'Mission A',
        description: 'Trigger Gemini rejection memory.',
        status: 'paused',
      })
      db.insertEvent('operator.gemini_pr_blocked', 'mission', mission.id, {
        code: 'GEMINI_NOT_PASS',
        reason: 'Missing regression test for exported parser behavior.',
        summary: 'Add parser regression coverage before PR.',
      })

      const lessons = projectTier2Lessons(db, { repoId: repo.id })
      expect(lessons).toHaveLength(1)
      expect(lessons[0]!.reason).toContain('Missing regression test')

      compileTier2LessonsToTier1(repo, lessons, homeDir)
      const memoryFile = await readFile(repoTier1MemoryPath(repo), 'utf8')
      expect(memoryFile).toContain('Missing regression test for exported parser behavior')

      const missionBContext = buildMemoryContext(repo, homeDir)
      expect(missionBContext).toContain('Missing regression test for exported parser behavior')
      expect(missionBContext).toContain('Operator Preferences')
    } finally {
      db.close()
    }
  })
})
