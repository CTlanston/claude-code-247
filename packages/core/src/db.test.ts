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

  it('updateMissionGitHub sets github fields on a mission', () => {
    const repo = db.insertRepo({ name: 'r1', path: '/tmp/r1', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'My mission', status: 'approved' })
    db.updateMissionGitHub(mission.id, { githubBranch: 'aedev/abc123', githubPrUrl: 'https://github.com/a/b/pull/5', githubPrNumber: 5 })
    const updated = db.getMission(mission.id)
    expect(updated?.githubBranch).toBe('aedev/abc123')
    expect(updated?.githubPrUrl).toBe('https://github.com/a/b/pull/5')
    expect(updated?.githubPrNumber).toBe(5)
  })

  it('insertMemoryItem throws when content contains secrets', () => {
    expect(() => db.insertMemoryItem({
      type: 'failure', title: 'Leaked creds', content: 'TOKEN=abc123', approved: false,
    })).toThrow('secrets')
  })

  it('insertMemoryItem stores and retrieves items', () => {
    const item = db.insertMemoryItem({ type: 'decision', title: 'Use retries', content: 'Always retry on timeout', approved: false })
    expect(item.id).toBeDefined()
    const items = db.listMemoryItems()
    expect(items).toHaveLength(1)
    db.approveMemoryItem(item.id)
    const approved = db.listMemoryItems({ approved: true })
    expect(approved).toHaveLength(1)
  })
})
