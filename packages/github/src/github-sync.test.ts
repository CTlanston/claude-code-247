import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { GitHubSync } from './github-sync.js'
import type { Octokit } from './client.js'

// Minimal Octokit mock
function mockOctokit(): Octokit {
  return {
    rest: {
      pulls: {
        create: vi.fn().mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/a/b/pull/42', state: 'open' } }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
      issues: {
        createComment: vi.fn().mockResolvedValue({ data: {} }),
        get: vi.fn().mockResolvedValue({ data: { number: 1, title: 'Fix bug', body: 'Details', html_url: 'https://github.com/a/b/issues/1', labels: [] } }),
      },
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  } as unknown as Octokit
}

let db: AedevDb
beforeEach(() => { db = new AedevDb(':memory:') })
afterEach(() => db.close())

describe('GitHubSync', () => {
  it('syncMission creates a PR and updates mission in DB', async () => {
    const repo = db.insertRepo({ name: 'r', path: '/tmp/r', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'Add dark mode', status: 'approved' })

    const sync = new GitHubSync(db, mockOctokit())
    const result = await sync.syncMission(mission.id, { owner: 'acme', repo: 'app', defaultBranch: 'main' })

    expect(result.prNumber).toBe(42)
    expect(result.prUrl).toBe('https://github.com/a/b/pull/42')

    const updated = db.getMission(mission.id)
    expect(updated?.githubPrNumber).toBe(42)
    expect(updated?.githubPrUrl).toBe('https://github.com/a/b/pull/42')
  })

  it('importIssue creates a draft mission', async () => {
    const repo = db.insertRepo({ name: 'r', path: '/tmp/r', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const sync = new GitHubSync(db, mockOctokit())
    const missionId = await sync.importIssue('acme', 'app', 1, repo.id)
    const m = db.getMission(missionId)
    expect(m?.status).toBe('draft')
    expect(m?.title).toBe('Fix bug')
  })

  it('buildEvidenceSummary includes mission title', () => {
    const repo = db.insertRepo({ name: 'r', path: '/tmp/r', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'My feature', status: 'approved' })
    const sync = new GitHubSync(db, mockOctokit())
    const summary = sync.buildEvidenceSummary(mission.id)
    expect(summary).toContain('My feature')
  })
})
