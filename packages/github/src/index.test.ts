import { describe, it, expect } from 'vitest'
import type { PrInfo, SyncConfig, SyncResult } from './index.js'

describe('github', () => {
  it('PrInfo has number, url, and state', () => {
    const pr: PrInfo = { number: 1, url: 'https://github.com/a/b/pull/1', state: 'open' }
    expect(pr.number).toBe(1)
    expect(pr.state).toBe('open')
  })

  it('SyncConfig has owner, repo, and defaultBranch', () => {
    const cfg: SyncConfig = { owner: 'acme', repo: 'my-app', defaultBranch: 'main' }
    expect(cfg.owner).toBe('acme')
    expect(cfg.defaultBranch).toBe('main')
  })

  it('SyncResult has missionId, prNumber, prUrl, branchName', () => {
    const result: SyncResult = { missionId: 'abc', prNumber: 5, prUrl: 'https://github.com/a/b/pull/5', branchName: 'aedev/abc' }
    expect(result.prNumber).toBe(5)
  })
})
