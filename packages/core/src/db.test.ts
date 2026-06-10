import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { AedevDb } from './db.js'
import { MIGRATIONS } from './migrations.js'

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

  it('attributes new events to operator "owner" by default and filters by operatorId (v5-P1)', () => {
    const def = db.insertEvent('task.created', 'task', 'task-1')
    expect(def.operatorId).toBe('owner')
    const alice = db.insertEvent('task.created', 'task', 'task-2', {}, 'alice')
    expect(alice.operatorId).toBe('alice')
    expect(db.queryEvents({ entityId: 'task-1' })[0]?.operatorId).toBe('owner')
    const aliceEvents = db.queryEvents({ operatorId: 'alice' })
    expect(aliceEvents).toHaveLength(1)
    expect(aliceEvents[0]?.entityId).toBe('task-2')
    expect(db.queryEvents({ type: 'task.created', operatorId: 'owner' })).toHaveLength(1)
  })

  it('treats pre-v5 rows without operator_id as "owner" at read time (ADR-0023 backfill rule, GR#5)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aedev-operator-id-'))
    const file = path.join(dir, 'state.db')
    try {
      // 1. Build an old-style DB: migrations up to v6 only — events has no operator_id column.
      const raw = new Database(file)
      raw.exec(`CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`)
      for (const m of MIGRATIONS.filter((mig) => mig.version <= 6)) {
        raw.exec(m.up)
        raw.prepare('INSERT INTO migrations (version, name, applied_at) VALUES (?,?,?)').run(m.version, m.name, '2026-01-01T00:00:00Z')
      }
      raw.prepare(`INSERT INTO events (id,type,entity_type,entity_id,payload,created_at)
                   VALUES ('ev_old','cost.headless_call','operator_session','s1','{}','2026-01-01T00:00:00Z')`).run()
      raw.close()
      // 2. Reopen through AedevDb — the v5-P1 migration adds the column; the old row stays NULL
      //    in storage but reads back as operator 'owner', so GR#5 rebuilds stay intact.
      const upgraded = new AedevDb(file)
      const owner = upgraded.queryEvents({ operatorId: 'owner' })
      expect(owner).toHaveLength(1)
      expect(owner[0]?.id).toBe('ev_old')
      expect(owner[0]?.operatorId).toBe('owner')
      expect(upgraded.queryEvents({ operatorId: 'alice' })).toHaveLength(0)
      upgraded.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
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

  it('registers, touches, and freezes fleet workers (v5-P2)', () => {
    const w = db.insertFleetWorker({ workerId: 'w-mac-1', operatorId: 'alice', publicKey: 'a'.repeat(64) })
    expect(w.status).toBe('active')
    expect(db.getFleetWorker('w-mac-1')?.operatorId).toBe('alice')
    expect(db.getFleetWorker('w-mac-1')?.lastSeenAt).toBeUndefined()

    db.touchFleetWorker('w-mac-1', '2026-06-10T01:00:00.000Z')
    expect(db.getFleetWorker('w-mac-1')?.lastSeenAt).toBe('2026-06-10T01:00:00.000Z')

    db.setFleetWorkerStatus('w-mac-1', 'frozen')
    expect(db.getFleetWorker('w-mac-1')?.status).toBe('frozen')
    expect(db.listFleetWorkers()).toHaveLength(1)
  })

  it('fleet nonces are first-write-wins with an optional cached response (idempotent claim, v5-P2)', () => {
    db.insertFleetWorker({ workerId: 'w1', operatorId: 'alice', publicKey: 'b'.repeat(64) })
    expect(db.recordFleetNonce('w1', 'n1', '/fleet/claim')).toBe(true)
    expect(db.recordFleetNonce('w1', 'n1', '/fleet/claim')).toBe(false) // replay
    expect(db.getFleetNonce('w1', 'n1')?.endpoint).toBe('/fleet/claim')
    expect(db.getFleetNonce('w1', 'n1')?.responseJson).toBeUndefined()
    db.saveFleetNonceResponse('w1', 'n1', '{"task":null}')
    expect(db.getFleetNonce('w1', 'n1')?.responseJson).toBe('{"task":null}')
    expect(db.getFleetNonce('w1', 'other')).toBeUndefined()
  })

  it('inserts and lists model_usage rows', () => {
    const repo = db.insertRepo({ name: 'r', path: '/tmp/r', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'm', status: 'approved' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 't', prompt: 'p', status: 'pending', attemptNumber: 1 })
    const run = db.insertRun({ taskId: task.id, runnerMode: 'docker', status: 'done' })
    const usage = db.insertModelUsage({
      taskId: task.id, runId: run.id, authMode: 'local_claude_code',
      model: 'claude-opus-4-8', provider: 'claude-docker',
      inputTokens: 1200, outputTokens: 340, costUsd: 0.07,
    })
    expect(usage.id).toBeDefined()
    const all = db.listModelUsage()
    expect(all).toHaveLength(1)
    expect(all[0]?.inputTokens).toBe(1200)
    expect(all[0]?.outputTokens).toBe(340)
    expect(all[0]?.authMode).toBe('local_claude_code')
    expect(all[0]?.provider).toBe('claude-docker')
    expect(db.listModelUsage(task.id)).toHaveLength(1)
    expect(db.listModelUsage('nonexistent')).toHaveLength(0)
  })
})
