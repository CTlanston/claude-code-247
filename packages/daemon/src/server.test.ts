import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'net'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'
import { IntakeService } from './intake.js'

let db: AedevDb
let stateDir: string
beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-server-test-'))
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

describe('createServer', () => {
  it('GET /status returns 200 with expected shape', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ status: string; version: string }>()
    expect(body.status).toBe('running')
    expect(body.version).toBe('0.0.1')
  })

  it('GET /missions returns empty array initially', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/missions' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ missions: unknown[] }>()
    expect(body.missions).toEqual([])
  })

  it('GET /missions/:id returns 404 for unknown id', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/missions/nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /events/stream exists (listen + real fetch + abort)', async () => {
    const app = createServer(db)
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
    } catch (e) {
      expect(isListenPermissionError(e)).toBe(true)
      return
    }
    const port = (app.server.address() as AddressInfo).port
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 80)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/events/stream`, { signal: ac.signal })
      expect(res.headers.get('content-type')).toContain('text/event-stream')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    } finally {
      await app.close()
    }
  })

  it('serves the real L0 smoke route contract', async () => {
    const app = createServer(db, new Date(), stateDir)

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json<{ status: string }>().status).toBe('green')

    const scan = await app.inject({ method: 'POST', url: '/missions/scan', payload: {} })
    expect(scan.statusCode).toBe(200)
    const scanned = scan.json<{ taskId: string; missionId: string }>()
    expect(scanned.taskId).toBeTruthy()

    const events = await app.inject({ method: 'GET', url: `/events?taskId=${scanned.taskId}` })
    expect(events.json<{ events: Array<{ kind: string }> }>().events[0]?.kind).toBe('roadmap.proposal.emitted')

    const missions = await app.inject({ method: 'GET', url: '/missions?status=approved&limit=1' })
    expect(missions.json<{ missions: Array<{ id: string }> }>().missions[0]?.id).toBe(scanned.missionId)

    const dispatch = await app.inject({ method: 'POST', url: `/missions/${scanned.missionId}/dispatch` })
    expect(dispatch.statusCode).toBe(200)

    const approval = await app.inject({
      method: 'POST',
      url: '/approvals',
      payload: { reason: 'smoke-check-3', operator: 'lanston' },
    })
    expect(approval.statusCode).toBe(200)
    const { approvalId } = approval.json<{ approvalId: string }>()
    const approved = await app.inject({ method: 'POST', url: `/approvals/${approvalId}/approve`, payload: { by: 'operator' } })
    expect(approved.statusCode).toBe(200)

    const sentinel = await app.inject({
      method: 'POST',
      url: '/sentinel/probe',
      payload: { tool: 'bash', args: 'cat .env.production' },
    })
    expect(sentinel.json<{ verdict: string }>().verdict).toBe('hard_block')

    const chaos = await app.inject({ method: 'POST', url: '/chaos/kill-session' })
    expect(chaos.statusCode).toBe(200)
    const resolved = await app.inject({ method: 'POST', url: '/chaos/resolve-latest-hold', payload: { by: 'operator' } })
    expect(resolved.statusCode).toBe(200)

    const metrics = await app.inject({ method: 'GET', url: '/metrics' })
    expect(metrics.body).toContain('events_total')

    const loki = await app.inject({ method: 'GET', url: '/loki/recent?limit=10' })
    expect(loki.statusCode).toBe(200)
  })

  it('runs the intake approval state machine through the API', async () => {
    const app = createServer(db, new Date(), stateDir)
    const intake = await app.inject({
      method: 'POST',
      url: '/intake',
      payload: { repoId: 'repo-1', description: 'Add sandbox page' },
    })
    expect(intake.statusCode).toBe(200)
    const { missionId } = intake.json<{ missionId: string }>()

    const directApprove = await app.inject({
      method: 'POST',
      url: `/missions/${missionId}/approve`,
      payload: { by: 'operator' },
    })
    expect(directApprove.statusCode).toBe(400)

    const pending = await app.inject({ method: 'POST', url: `/missions/${missionId}/request-approval` })
    expect(pending.statusCode).toBe(200)
    expect(pending.json<{ status: string }>().status).toBe('pending_approval')

    const beforeApprove = await app.inject({ method: 'GET', url: `/missions/${missionId}/can-execute` })
    expect(beforeApprove.json<{ canExecute: boolean }>().canExecute).toBe(false)

    const approved = await app.inject({
      method: 'POST',
      url: `/missions/${missionId}/approve`,
      payload: { by: 'operator' },
    })
    expect(approved.statusCode).toBe(200)
    expect(approved.json<{ status: string }>().status).toBe('approved')

    const afterApprove = await app.inject({ method: 'GET', url: `/missions/${missionId}/can-execute` })
    expect(afterApprove.json<{ canExecute: boolean }>().canExecute).toBe(true)
  })

  it('defaults intake artifacts under AEDEV_HOME/state when no explicit stateDir is passed', async () => {
    const aedevHome = mkdtempSync(join(tmpdir(), 'aedev-home-'))
    const previous = process.env['AEDEV_HOME']
    process.env['AEDEV_HOME'] = aedevHome

    try {
      const app = createServer(db)
      const intake = await app.inject({
        method: 'POST',
        url: '/intake',
        payload: { repoId: 'repo-1', description: 'Create default-state PRD' },
      })

      expect(intake.statusCode).toBe(200)
      const { missionId } = intake.json<{ missionId: string }>()
      expect(existsSync(join(aedevHome, 'state', 'prd', `${missionId}.md`))).toBe(true)
      expect(existsSync(join(aedevHome, 'prd', `${missionId}.md`))).toBe(false)
    } finally {
      restoreEnv('AEDEV_HOME', previous)
      rmSync(aedevHome, { recursive: true, force: true })
    }
  })

  it('scans repo-backed intake sources into draft missions through the API', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'aedev-intake-scan-'))
    try {
      const repo = db.insertRepo({
        name: 'scan-target',
        path: repoPath,
        defaultBranch: 'main',
        enabled: true,
        testCommands: [],
        forbiddenPaths: [],
        riskRules: {},
        mergePolicy: 'WAITING',
      })
      writeFileSync(join(repoPath, 'src.ts'), '// TODO: scan this repo\n')

      const app = createServer(db, new Date(), stateDir)
      const res = await app.inject({
        method: 'POST',
        url: '/intake/scan',
        payload: { repoId: repo.id, capPerRepo: 5 },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json<{ created: number; missions: Array<{ missionStatus?: string }> }>()
      expect(body.created).toBe(1)
      expect(body.missions[0]?.missionStatus).toBe('draft')
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('holds mission runs when runtime worker discovery finds no available sessions', async () => {
    const oldDisableClaude = process.env['AEDEV_DISABLE_CLAUDE_CLI']
    const oldDisableCodex = process.env['AEDEV_DISABLE_CODEX_CLI']
    const oldDisableGemini = process.env['AEDEV_DISABLE_GEMINI_API']
    const oldDisableOpenai = process.env['AEDEV_DISABLE_OPENAI_API']
    process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
    process.env['AEDEV_DISABLE_CODEX_CLI'] = '1'
    process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
    process.env['AEDEV_DISABLE_OPENAI_API'] = '1'

    try {
      const repo = db.insertRepo({
        name: 'run-target',
        path: stateDir,
        defaultBranch: 'main',
        enabled: true,
        testCommands: [],
        forbiddenPaths: [],
        riskRules: {},
        mergePolicy: 'WAITING',
      })
      const intake = new IntakeService(db, stateDir)
      const mission = intake.createMissionCandidate(repo.id, 'Exercise runtime worker discovery hold.', 'Runtime hold')
      intake.requestApproval(mission.id)
      intake.approveMission(mission.id, 'operator')

      const app = createServer(db, new Date(), stateDir)
      const res = await app.inject({ method: 'POST', url: `/missions/${mission.id}/run` })

      expect(res.statusCode).toBe(200)
      expect(res.json<{ status: string; mergeDecision: string }>().status).toBe('waiting')
      expect(db.getMission(mission.id)?.status).toBe('paused')
    } finally {
      restoreEnv('AEDEV_DISABLE_CLAUDE_CLI', oldDisableClaude)
      restoreEnv('AEDEV_DISABLE_CODEX_CLI', oldDisableCodex)
      restoreEnv('AEDEV_DISABLE_GEMINI_API', oldDisableGemini)
      restoreEnv('AEDEV_DISABLE_OPENAI_API', oldDisableOpenai)
    }
  })
})

function isListenPermissionError(error: unknown): boolean {
  return /listen EPERM|operation not permitted/i.test((error as Error).message)
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
