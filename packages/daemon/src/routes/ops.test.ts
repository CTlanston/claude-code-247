/**
 * cloudhull-c6 — owner "Operations" view backend.
 *
 * GET /ops/overview is read-only and derived ENTIRELY from the event log,
 * hold rows, and config/env — zero LLM calls, zero subprocess spawns (GR#8;
 * probing `claude` costs real subscription credit).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Fastify, { type FastifyInstance } from 'fastify'
import { AedevDb, type MissionStatus } from '@aedev/core'
import { registerOpsRoutes, CLAUDE_LOGIN_RECOVERY, type OpsOverview } from './ops.js'

let db: AedevDb
let app: FastifyInstance
let stateDir: string
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = ['AEDEV_ALLOW_REMOTE_WRITES', 'AEDEV_REMOTE_WRITE_WHITELIST', 'HOME'] as const

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = join(tmpdir(), `aedev-ops-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(stateDir, { recursive: true })
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  delete process.env['AEDEV_ALLOW_REMOTE_WRITES']
  delete process.env['AEDEV_REMOTE_WRITE_WHITELIST']
  process.env['HOME'] = stateDir // keep the real ~/.aedev config out of the test
})

afterEach(async () => {
  if (app) await app.close()
  db.close()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  rmSync(stateDir, { recursive: true, force: true })
})

/** Build the route with an injected engine env (defaults to NO provider keys
 *  so a developer machine's real GEMINI key cannot leak into assertions). */
async function getOverview(env: NodeJS.ProcessEnv = {}): Promise<OpsOverview> {
  app = Fastify({ logger: false })
  registerOpsRoutes(app, db, stateDir, { env })
  const res = await app.inject({ method: 'GET', url: '/ops/overview' })
  expect(res.statusCode).toBe(200)
  return res.json() as OpsOverview
}

function seedMission(status: MissionStatus, title = 'mission'): string {
  const repo = db.insertRepo({
    name: `ops-repo-${Math.random().toString(16).slice(2, 10)}`, path: '/tmp/ops-repo', defaultBranch: 'main',
    enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
  return db.insertMission({ repoId: repo.id, title, status }).id
}

describe('GET /ops/overview — empty state', () => {
  it('returns a calm, fully-shaped overview when nothing has happened yet', async () => {
    const o = await getOverview()
    expect(o.activeHolds).toEqual([])
    expect(o.activeMissions).toEqual([])
    expect(o.lastValidator).toBeNull()
    expect(o.remoteWrites).toEqual({ enabled: false, whitelist: [] })
    expect(o.engines.claude).toBe('unknown')
    expect(o.engines.codex).toBe('unknown')
    expect(o.engines.gemini).toBe('not_configured')
    expect(o.suggestedRecovery).not.toContain(CLAUDE_LOGIN_RECOVERY)
  })
})

describe('GET /ops/overview — engines from RECENT events only (no probes)', () => {
  it('an injected HOLD-PLANNER-AUTH event makes claude needs_login with the exact recovery sentence', async () => {
    db.insertEvent('operator.hold_created', 'operator_session', 's-1', {
      holdCode: 'HOLD-PLANNER-AUTH',
      reason: 'API Error: 401 authentication_error',
    })
    db.insertHold({
      entityType: 'operator_session', entityId: 's-1',
      code: 'HOLD-PLANNER-AUTH', reason: 'API Error: 401 authentication_error',
    })
    const o = await getOverview()
    expect(o.engines.claude).toBe('needs_login')
    expect(o.suggestedRecovery).toContain('Claude planner needs login on this Mac · 在这台 Mac 上运行 claude login')
    // the hold is exposed with HUMANIZED text (user-state mapping), code kept as data
    expect(o.activeHolds).toHaveLength(1)
    expect(o.activeHolds[0]?.code).toBe('HOLD-PLANNER-AUTH')
    expect(o.activeHolds[0]?.text).toContain('claude login')
    expect(o.activeHolds[0]?.text).not.toContain('HOLD-PLANNER-AUTH')
    expect(o.activeHolds[0]?.createdAt).toBeTruthy()
  })

  it('a successful recorded claude headless call marks claude ready (events, not probes)', async () => {
    db.insertEvent('cost.headless_call', 'operator_session', 's-1', {
      role: 'planner', provider: 'claude-cli', exitCode: 0,
    })
    const o = await getOverview()
    expect(o.engines.claude).toBe('ready')
  })

  it('a successful recorded codex call marks codex ready', async () => {
    db.insertEvent('cost.headless_call', 'operator_session', 's-1', {
      role: 'worker', provider: 'codex-cli', exitCode: 0,
    })
    const o = await getOverview()
    expect(o.engines.codex).toBe('ready')
  })

  it('gemini is ready from key env presence alone (never spawned)', async () => {
    const o = await getOverview({ AEDEV_GEMINI_API_KEY: 'k' })
    expect(o.engines.gemini).toBe('ready')
  })
})

describe('GET /ops/overview — remote writes reflect env', () => {
  it('mirrors AEDEV_ALLOW_REMOTE_WRITES and the whitelist', async () => {
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '1'
    process.env['AEDEV_REMOTE_WRITE_WHITELIST'] = 'hermus-agent'
    const o = await getOverview()
    expect(o.remoteWrites).toEqual({ enabled: true, whitelist: ['hermus-agent'] })
  })
})

describe('GET /ops/overview — lastValidator from validator events', () => {
  it('reads the latest operator.validator_result event', async () => {
    db.insertEvent('operator.validators_not_configured', 'mission', 'm-1', { status: 'not_configured' })
    db.insertEvent('operator.validator_result', 'mission', 'm-1', {
      validator: 'gemini', verdict: 'PASS', summary: 'looks good',
    })
    const o = await getOverview()
    expect(o.lastValidator?.status).toBe('done')
    expect(o.lastValidator?.verdict).toBe('PASS')
    expect(o.lastValidator?.atIso).toBeTruthy()
  })

  it('reports not_configured honestly when that is the only validator signal', async () => {
    db.insertEvent('operator.validators_not_configured', 'mission', 'm-1', { status: 'not_configured' })
    const o = await getOverview()
    expect(o.lastValidator?.status).toBe('not_configured')
    expect(o.lastValidator?.verdict).toBeNull()
  })
})

describe('GET /ops/overview — active missions', () => {
  it('lists non-terminal missions with submittedBy from the linked operator session', async () => {
    const runningId = seedMission('running', 'live mission')
    seedMission('done', 'finished mission')
    db.insertOperatorSession({
      title: 'live mission', prompt: 'p', status: 'running',
      missionId: runningId, submittedBy: 'Alice',
    })
    const o = await getOverview()
    expect(o.activeMissions).toHaveLength(1)
    expect(o.activeMissions[0]).toMatchObject({
      id: runningId, title: 'live mission', status: 'running', submittedBy: 'Alice',
    })
  })

  it('backfills submittedBy as owner when no session names a user', async () => {
    seedMission('pending_approval', 'unattributed')
    const o = await getOverview()
    expect(o.activeMissions[0]?.submittedBy).toBe('owner')
  })
})
