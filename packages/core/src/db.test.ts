import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from './db.js'

let db: AedevDb
beforeEach(() => { db = new AedevDb(':memory:') })
afterEach(() => db.close())

describe('AedevDb', () => {
  it('runs migrations on construction', () => {
    const event = db.insertEvent('heartbeat')
    expect(event.id).toBeDefined()
    expect(event.type).toBe('heartbeat')
  })

  it('inserts and retrieves a repo', () => {
    const repo = db.insertRepo({
      name: 'my-app', path: '/tmp/my-app', defaultBranch: 'main',
      enabled: true, testCommands: ['npm test'], forbiddenPaths: ['.env*'],
      riskRules: {}, mergePolicy: 'WAITING',
    })
    expect(repo.id).toBeDefined()
    const found = db.getRepo(repo.id)
    expect(found?.name).toBe('my-app')
    expect(found?.testCommands).toEqual(['npm test'])
  })

  it('inserts and queries events with filters', () => {
    db.insertEvent('task.created', 'task', 'task-1')
    db.insertEvent('heartbeat')
    db.insertEvent('task.created', 'task', 'task-2')
    const taskEvents = db.queryEvents({ type: 'task.created' })
    expect(taskEvents).toHaveLength(2)
    const byEntityId = db.queryEvents({ entityId: 'task-1' })
    expect(byEntityId).toHaveLength(1)
  })
})
