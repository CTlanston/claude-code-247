import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from './db.js'

// cloudhull-c5 — operator sessions carry the submitting user's display name.
// Pre-v9 rows (NULL submitted_by) read back as 'owner' (backfill-at-read,
// same rule as events.operator_id / ADR-0023).

let db: AedevDb
beforeEach(() => { db = new AedevDb(':memory:') })
afterEach(() => db.close())

describe('operator_sessions.submitted_by', () => {
  it('round-trips submittedBy through insert/get/list', () => {
    const session = db.insertOperatorSession({ title: 'T', prompt: 'p', status: 'brainstorming', submittedBy: 'Alice' })
    expect(session.submittedBy).toBe('Alice')
    expect(db.getOperatorSession(session.id)?.submittedBy).toBe('Alice')
    expect(db.listOperatorSessions().find((s) => s.id === session.id)?.submittedBy).toBe('Alice')
  })

  it('backfills NULL submitted_by as "owner" at read (pre-v9 rows)', () => {
    const session = db.insertOperatorSession({ title: 'T', prompt: 'p', status: 'brainstorming' })
    expect(db.getOperatorSession(session.id)?.submittedBy).toBe('owner')
    expect(db.listOperatorSessions()[0]?.submittedBy).toBe('owner')
  })
})
