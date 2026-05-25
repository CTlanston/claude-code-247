import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { ApprovalGate } from './approval.js'

let db: AedevDb, gate: ApprovalGate
beforeEach(() => { db = new AedevDb(':memory:'); gate = new ApprovalGate(db) })
afterEach(() => db.close())

describe('ApprovalGate', () => {
  it('requireApproval creates pending approval', () => {
    const a = gate.requireApproval('mission', 'mission-1', 'needs review')
    expect(a.status).toBe('pending')
    expect(gate.getPendingApprovals()).toHaveLength(1)
  })

  it('approve transitions to approved', () => {
    const a = gate.requireApproval('mission', 'mission-1', 'needs review')
    const approved = gate.approve(a.id, 'operator', 'LGTM')
    expect(approved.status).toBe('approved')
    expect(gate.getPendingApprovals()).toHaveLength(0)
  })

  it('reject transitions to rejected', () => {
    const a = gate.requireApproval('mission', 'mission-1', 'needs review')
    const rejected = gate.reject(a.id, 'operator', 'too risky')
    expect(rejected.status).toBe('rejected')
  })
})
