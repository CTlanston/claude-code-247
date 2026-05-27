import { describe, it, expect } from 'vitest'
import { buildDashboardServer } from './server.js'
import type { StatusBoardInput } from './status-board.js'

const SAMPLE: StatusBoardInput = {
  missionsOpen: 1, missionsTotal: 7,
  tasksRunning: 2, tasksQueued: 3,
  holdsOpen: 0, approvalsPending: 1,
  sessionHealth: 'healthy', quotaFraction: 0.33,
}

describe('dashboard · Fastify server (Stage F2 runtime L1)', () => {
  it('case 1: /health returns ok with deterministic ts under injected clock', async () => {
    const srv = buildDashboardServer({ snapshot: () => SAMPLE, now: () => new Date('2026-05-27T01:00:00Z') })
    const r = await srv.inject({ method: 'GET', url: '/health' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body)).toEqual({ ok: true, ts: '2026-05-27T01:00:00.000Z' })
    await srv.close()
  })

  it('case 2: /status-board.json returns the locked contract shape', async () => {
    const srv = buildDashboardServer({ snapshot: () => SAMPLE, now: () => new Date('2026-05-27T01:00:00Z') })
    const r = await srv.inject({ method: 'GET', url: '/status-board.json' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('application/json')
    const body = JSON.parse(r.body)
    expect(Object.keys(body).sort()).toEqual(
      ['approvals', 'cli', 'generated_at', 'holds', 'missions', 'schema_version', 'tasks'].sort(),
    )
    await srv.close()
  })

  it('case 3: two requests at the same injected ts return byte-equal bodies (modulo generated_at if changed)', async () => {
    const srv = buildDashboardServer({ snapshot: () => SAMPLE, now: () => new Date('2026-05-27T01:00:00Z') })
    const a = await srv.inject({ method: 'GET', url: '/status-board.json' })
    const b = await srv.inject({ method: 'GET', url: '/status-board.json' })
    expect(a.body).toBe(b.body)
    await srv.close()
  })

  it('case 4: snapshot fn drives the payload (cli.quota_fraction reflected)', async () => {
    let f = 0.1
    const srv = buildDashboardServer({
      snapshot: () => ({ ...SAMPLE, quotaFraction: f }),
      now: () => new Date('2026-05-27T01:00:00Z'),
    })
    const a = JSON.parse((await srv.inject({ method: 'GET', url: '/status-board.json' })).body)
    expect(a.cli.quota_fraction).toBeCloseTo(0.1)
    f = 0.9
    const b = JSON.parse((await srv.inject({ method: 'GET', url: '/status-board.json' })).body)
    expect(b.cli.quota_fraction).toBeCloseTo(0.9)
    await srv.close()
  })
})
