import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'

// v6-P1 — OperatorMissionView.card wiring: every mission overview carries
// exactly ONE of the five ordinary-user cards, populated from existing view
// data. Contract: docs/product/LOOP_COMMUNICATION_PROTOCOL.md.

let db: AedevDb
let stateDir: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-loop-card-'))
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

function makeRepo() {
  return db.insertRepo({
    name: 'loop-card', path: stateDir, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
}

interface CardShape {
  operatorView: {
    userState: { state: string }
    card: {
      type: string
      title: string
      next_step: string
      machine: { user_state: string; stage: string; hold_code: string | null; pr_gate_code: string | null }
      [key: string]: unknown
    }
  }
}

async function overviewFor(missionId: string): Promise<CardShape> {
  const app = createServer(db, new Date(), stateDir)
  const res = await app.inject({ method: 'GET', url: `/missions/${missionId}/overview` })
  expect(res.statusCode).toBe(200)
  return res.json() as CardShape
}

describe('operator overview — five-card wiring', () => {
  it('pending-approval mission → plan card requiring approval', async () => {
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'pending_approval' })
    db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'add dark mode', status: 'roadmap_ready' })

    const ov = await overviewFor(mission.id)
    expect(ov.operatorView.card.type).toBe('plan')
    expect(ov.operatorView.card['requires_approval']).toBe(true)
    expect(ov.operatorView.card['objective']).toBe('add dark mode')
    expect(ov.operatorView.card.next_step.length).toBeGreaterThan(0)
  })

  it('active HOLD → blocker card with the raw code only in machine', async () => {
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'approved' })
    db.insertHold({ entityType: 'mission', entityId: mission.id, code: 'HOLD-BUDGET', reason: 'daily cap reached' })

    const ov = await overviewFor(mission.id)
    expect(ov.operatorView.card.type).toBe('blocker')
    expect(ov.operatorView.card.machine.hold_code).toBe('HOLD-BUDGET')
    const visible: Record<string, unknown> = { ...ov.operatorView.card }
    delete visible['machine']
    expect(JSON.stringify(visible)).not.toContain('HOLD-BUDGET')
    expect(String(ov.operatorView.card['human_explanation'])).toContain('今日预算已用完')
  })

  it('card type always matches the userState mapping', async () => {
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'draft' })
    db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'brainstorming' })

    const ov = await overviewFor(mission.id)
    expect(ov.operatorView.userState.state).toBe('understanding')
    expect(ov.operatorView.card.type).toBe('understanding')
    expect(ov.operatorView.card.machine.user_state).toBe('understanding')
  })
})
