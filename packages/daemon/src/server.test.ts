import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'net'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'

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
    await app.listen({ port: 0, host: '127.0.0.1' })
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
})
