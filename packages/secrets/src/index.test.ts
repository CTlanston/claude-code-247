import { describe, it, expect } from 'vitest'
import type { SecretGrant, SecretGrantStatus } from './index.js'

describe('secrets', () => {
  it('SecretGrantStatus covers active, expired, revoked', () => {
    const statuses: SecretGrantStatus[] = ['active', 'expired', 'revoked']
    expect(statuses).toHaveLength(3)
  })

  it('SecretGrant has required fields', () => {
    const grant: SecretGrant = {
      id: 'grant-001',
      secretName: 'GITHUB_TOKEN',
      taskId: 'task-001',
      ttlSeconds: 3600,
      grantedBy: 'operator',
      grantedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      reason: 'integration test',
      status: 'active',
    }
    expect(grant.secretName).toBe('GITHUB_TOKEN')
    expect(grant.ttlSeconds).toBe(3600)
  })
})
