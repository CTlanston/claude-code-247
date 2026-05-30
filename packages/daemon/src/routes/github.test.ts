import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { createServer } from '../server.js'

describe('POST /github/sync — allow_remote_writes safety gate', () => {
  const prevAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
  const prevToken = process.env['AEDEV_GITHUB_TOKEN']
  let db: AedevDb
  let stateDir: string

  beforeEach(() => {
    db = new AedevDb(':memory:')
    stateDir = mkdtempSync(join(tmpdir(), 'gh-gate-'))
  })
  afterEach(() => {
    if (prevAllow === undefined) delete process.env['AEDEV_ALLOW_REMOTE_WRITES']
    else process.env['AEDEV_ALLOW_REMOTE_WRITES'] = prevAllow
    if (prevToken === undefined) delete process.env['AEDEV_GITHUB_TOKEN']
    else process.env['AEDEV_GITHUB_TOKEN'] = prevToken
    db.close()
  })

  it('blocks the real PR with 403 when allow_remote_writes=false — even with a GitHub token present', async () => {
    // Token present so we prove the *gate* blocks, not the missing-token branch.
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = 'false'
    process.env['AEDEV_GITHUB_TOKEN'] = 'ghp_fake_token_for_test'

    const repo = db.insertRepo({
      name: 'r', path: '/tmp/r', githubOwner: 'o', githubRepo: 'r',
      defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [],
      riskRules: {}, mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: 't', description: 'd', status: 'approved' })

    const app = createServer(db, new Date(), stateDir)
    const res = await app.inject({
      method: 'POST', url: `/github/sync/${mission.id}`, payload: { owner: 'o', repo: 'r' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/REMOTE_WRITES_DISABLED/)
    // The block was recorded and no octokit/network call happened.
    expect(db.queryEvents({ type: 'github.sync_blocked' }).length).toBe(1)
    await app.close()
  })
})
