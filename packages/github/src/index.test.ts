import { describe, it, expect } from 'vitest'
import type { GitHubRepo, PrStatus } from './index.js'

describe('github', () => {
  it('GitHubRepo has owner, repo, and defaultBranch', () => {
    const r: GitHubRepo = {
      owner: 'acme',
      repo: 'my-app',
      defaultBranch: 'main',
    }
    expect(r.owner).toBe('acme')
    expect(r.defaultBranch).toBe('main')
  })

  it('PrStatus covers expected values', () => {
    const statuses: PrStatus[] = ['open', 'closed', 'merged', 'draft']
    expect(statuses).toHaveLength(4)
  })
})
