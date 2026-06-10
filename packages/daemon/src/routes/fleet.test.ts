import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { AedevDb, type Task } from '@aedev/core'
import { registerFleetRoutes } from './fleet.js'
import { signFleetMessage, rawPublicKeyHex, canonicalJson } from '../fleet/signing.js'
import { type FleetClock, MAX_SENT_AT_SKEW_MS, HEARTBEAT_TIMEOUT_MS } from '../fleet/auth.js'
import { detectEvidenceMismatch } from '../fleet/claims.js'
import { recordHeadlessCall, HOLD_BUDGET_CODE } from '../headless-budget-guard.js'
import { createServer } from '../server.js'

const T0 = Date.parse('2026-06-10T08:00:00.000Z')
const MIN = 60_000

let db: AedevDb
let app: FastifyInstance
let nowMs: number
const clock: FleetClock = { now: () => nowMs }

interface TestWorker {
  workerId: string
  operatorId: string
  publicKey: string
  privateKey: KeyObject
}

function makeKeys(): { publicKey: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKey: rawPublicKeyHex(publicKey), privateKey }
}

function signedHeaders(w: TestWorker, body: unknown, opts: { nonce?: string; sentAtMs?: number } = {}) {
  const nonce = opts.nonce ?? randomUUID()
  const sentAt = new Date(opts.sentAtMs ?? nowMs).toISOString()
  return {
    'x-worker-id': w.workerId,
    'x-nonce': nonce,
    'x-sent-at': sentAt,
    'x-signature': signFleetMessage(w.privateKey, body, nonce, sentAt),
  }
}

async function registerWorker(workerId: string, operatorId: string): Promise<TestWorker> {
  const keys = makeKeys()
  const res = await app.inject({
    method: 'POST', url: '/fleet/register',
    payload: { workerId, operatorId, publicKey: keys.publicKey },
  })
  expect(res.statusCode).toBe(200)
  return { workerId, operatorId, ...keys }
}

async function post(url: string, w: TestWorker, body: Record<string, unknown>, opts: { nonce?: string; sentAtMs?: number } = {}) {
  return app.inject({ method: 'POST', url, payload: body, headers: signedHeaders(w, body, opts) })
}

function seedTasks(count: number): Task[] {
  const repo = db.insertRepo({
    name: `fleet-repo-${randomUUID().slice(0, 8)}`, path: '/tmp/fleet-repo', defaultBranch: 'main',
    enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
  const mission = db.insertMission({ repoId: repo.id, title: 'fleet mission', status: 'approved' })
  const tasks: Task[] = []
  for (let i = 0; i < count; i++) {
    tasks.push(db.insertTask({
      missionId: mission.id, repoId: repo.id, title: `t${i}`, prompt: `do ${i}`,
      status: 'pending', attemptNumber: 0,
    }))
  }
  return tasks
}

beforeEach(() => {
  db = new AedevDb(':memory:')
  nowMs = T0
  app = Fastify({ logger: false })
  registerFleetRoutes(app, db, { clock })
})
afterEach(async () => {
  await app.close()
  db.close()
})

describe('POST /fleet/register — worker registry', () => {
  it('registers a worker with an ed25519 public key and emits fleet.worker_registered', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const stored = db.getFleetWorker('w-alice-1')
    expect(stored?.operatorId).toBe('alice')
    expect(stored?.publicKey).toBe(w.publicKey)
    expect(stored?.status).toBe('active')
    const events = db.queryEvents({ type: 'fleet.worker_registered', entityId: 'w-alice-1' })
    expect(events).toHaveLength(1)
    expect(events[0]?.operatorId).toBe('alice')
  })

  it('re-registration with the same key is idempotent; a different key is a 409 (no key takeover)', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const again = await app.inject({
      method: 'POST', url: '/fleet/register',
      payload: { workerId: 'w-alice-1', operatorId: 'alice', publicKey: w.publicKey },
    })
    expect(again.statusCode).toBe(200)
    const takeover = await app.inject({
      method: 'POST', url: '/fleet/register',
      payload: { workerId: 'w-alice-1', operatorId: 'mallory', publicKey: makeKeys().publicKey },
    })
    expect(takeover.statusCode).toBe(409)
    expect(db.getFleetWorker('w-alice-1')?.operatorId).toBe('alice')
  })

  it('rejects a public key that is not 32-byte raw ed25519 hex', async () => {
    const res = await app.inject({
      method: 'POST', url: '/fleet/register',
      payload: { workerId: 'w-bad', operatorId: 'alice', publicKey: 'not-hex' },
    })
    expect(res.statusCode).toBe(400)
    expect(db.getFleetWorker('w-bad')).toBeUndefined()
  })
})

describe('RED LINE — fleet payloads must never carry credentials (ADR-0022)', () => {
  it('rejects registration bodies with credential-shaped fields', async () => {
    for (const field of ['token', 'apiKey', 'api_key', 'api-key', 'clientSecret']) {
      const res = await app.inject({
        method: 'POST', url: '/fleet/register',
        payload: { workerId: 'w-x', operatorId: 'alice', publicKey: 'a'.repeat(64), [field]: 'sk-oops' },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('credential_field_forbidden')
    }
    expect(db.getFleetWorker('w-x')).toBeUndefined()
    expect(db.queryEvents({ type: 'fleet.rejected_event' }).length).toBeGreaterThanOrEqual(5)
  })

  it('rejects claim/event bodies with credential-shaped fields, even nested, and ingests nothing', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    seedTasks(1)
    const claimBody = { hints: { ghToken: 'ghp_abc' } }
    const claim = await post('/fleet/claim', w, claimBody)
    expect(claim.statusCode).toBe(400)
    expect(claim.json().error).toBe('credential_field_forbidden')

    const evBody = { events: [{ type: 'worker.note', payload: { nested: { OPENAI_SECRET: 'x' } } }] }
    const ev = await post('/fleet/events', w, evBody)
    expect(ev.statusCode).toBe(400)
    expect(db.queryEvents({ type: 'worker.note' })).toHaveLength(0)
    expect(db.queryEvents({ type: 'fleet.task_claimed' })).toHaveLength(0)
  })
})

describe('fleet request authentication (Ed25519 + nonce + time window)', () => {
  it('rejects an unknown worker with 401 and a fleet.rejected_event', async () => {
    const ghost: TestWorker = { workerId: 'w-ghost', operatorId: 'x', ...makeKeys() }
    const res = await post('/fleet/heartbeat', ghost, {})
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unknown_worker')
    expect(db.queryEvents({ type: 'fleet.rejected_event' })).toHaveLength(1)
  })

  it('rejects a bad signature (signed by a different key) with 401', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const impostor: TestWorker = { ...w, privateKey: makeKeys().privateKey }
    const res = await post('/fleet/heartbeat', impostor, {})
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('bad_signature')
    const rejected = db.queryEvents({ type: 'fleet.rejected_event' })
    expect(rejected.some((e) => String(e.payload['reason']).includes('bad_signature'))).toBe(true)
  })

  it('rejects a tampered body (signature does not match what was sent)', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const headers = signedHeaders(w, { events: [{ type: 'worker.ok' }] })
    const res = await app.inject({
      method: 'POST', url: '/fleet/events',
      payload: { events: [{ type: 'worker.evil' }] }, headers,
    })
    expect(res.statusCode).toBe(401)
    expect(db.queryEvents({ type: 'worker.evil' })).toHaveLength(0)
  })

  it('rejects stale sent_at beyond the 5-minute window with 401', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const res = await post('/fleet/heartbeat', w, {}, { sentAtMs: nowMs - MAX_SENT_AT_SKEW_MS - MIN })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('stale_sent_at')
  })

  it('rejects a replayed nonce on /fleet/events with 401 and ingests nothing twice', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const body = { events: [{ type: 'worker.gate_passed', payload: { gate: 'lint' } }] }
    const nonce = randomUUID()
    const first = await post('/fleet/events', w, body, { nonce })
    expect(first.statusCode).toBe(200)
    const replay = await post('/fleet/events', w, body, { nonce })
    expect(replay.statusCode).toBe(401)
    expect(replay.json().error).toBe('replayed_nonce')
    expect(db.queryEvents({ type: 'worker.gate_passed' })).toHaveLength(1)
  })
})

describe('POST /fleet/claim + /fleet/heartbeat — claim protocol', () => {
  it('assigns the oldest unclaimed pending task and records fleet.task_claimed with the registry operator', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const tasks = seedTasks(2)
    const res = await post('/fleet/claim', w, {})
    expect(res.statusCode).toBe(200)
    expect(res.json().task.id).toBe(tasks[0]!.id)
    const claims = db.queryEvents({ type: 'fleet.task_claimed', entityId: tasks[0]!.id })
    expect(claims).toHaveLength(1)
    expect(claims[0]?.operatorId).toBe('alice')
    expect(claims[0]?.payload['workerId']).toBe('w-alice-1')
  })

  it('is idempotent: replaying the same (workerId, nonce) claim returns the same task without a second claim', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const tasks = seedTasks(2)
    const nonce = randomUUID()
    const first = await post('/fleet/claim', w, {}, { nonce })
    const second = await post('/fleet/claim', w, {}, { nonce })
    expect(second.statusCode).toBe(200)
    expect(second.json().task.id).toBe(first.json().task.id)
    expect(second.json().task.id).toBe(tasks[0]!.id)
    expect(db.queryEvents({ type: 'fleet.task_claimed' })).toHaveLength(1)
  })

  it('two workers claiming concurrently never receive the same task', async () => {
    const a = await registerWorker('w-alice-1', 'alice')
    const b = await registerWorker('w-bob-1', 'bob')
    const tasks = seedTasks(2)
    const resA = await post('/fleet/claim', a, {})
    const resB = await post('/fleet/claim', b, {})
    const got = [resA.json().task.id, resB.json().task.id]
    expect(new Set(got).size).toBe(2)
    expect(new Set(got)).toEqual(new Set(tasks.map((t) => t.id)))
  })

  it('returns task:null when nothing is pending', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const res = await post('/fleet/claim', w, {})
    expect(res.statusCode).toBe(200)
    expect(res.json().task).toBeNull()
  })

  it('heartbeat updates last_seen and keeps the claim held against other workers', async () => {
    const a = await registerWorker('w-alice-1', 'alice')
    const b = await registerWorker('w-bob-1', 'bob')
    const tasks = seedTasks(2)
    const claimed = await post('/fleet/claim', a, {})
    expect(claimed.json().task.id).toBe(tasks[0]!.id)
    nowMs += 9 * MIN
    const hb = await post('/fleet/heartbeat', a, {})
    expect(hb.statusCode).toBe(200)
    expect(db.getFleetWorker('w-alice-1')?.lastSeenAt).toBe(new Date(nowMs).toISOString())
    nowMs += 9 * MIN // 18min after claim, but only 9min after heartbeat -> still alive
    const resB = await post('/fleet/claim', b, {})
    expect(resB.json().task.id).toBe(tasks[1]!.id)
  })

  it('kill-and-reclaim: a task claimed by a worker silent for >10min is handed to the next claimer', async () => {
    const a = await registerWorker('w-alice-1', 'alice')
    const b = await registerWorker('w-bob-1', 'bob')
    const tasks = seedTasks(1)
    const claimed = await post('/fleet/claim', a, {})
    expect(claimed.json().task.id).toBe(tasks[0]!.id)
    // worker A is kill -9'd: no heartbeat past the timeout
    nowMs += HEARTBEAT_TIMEOUT_MS + MIN
    const resB = await post('/fleet/claim', b, {})
    expect(resB.statusCode).toBe(200)
    expect(resB.json().task.id).toBe(tasks[0]!.id)
    expect(db.queryEvents({ type: 'fleet.task_claimed', entityId: tasks[0]!.id })).toHaveLength(2)
  })
})

describe('POST /fleet/events — evidence ingestion with registry-bound operator identity', () => {
  it('batch-appends events attributed to the registry operator with worker provenance', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const [task] = seedTasks(1)
    const body = {
      events: [
        { type: 'worker.gate_passed', entityType: 'task', entityId: task!.id, payload: { gate: 'lint' } },
        // a spoofed operatorId inside the payload must NOT override the registry binding
        { type: 'worker.gate_passed', entityType: 'task', entityId: task!.id, payload: { gate: 'test', operatorId: 'mallory' } },
      ],
    }
    const res = await post('/fleet/events', w, body)
    expect(res.statusCode).toBe(200)
    expect(res.json().ingested).toBe(2)
    const stored = db.queryEvents({ type: 'worker.gate_passed' })
    expect(stored).toHaveLength(2)
    for (const e of stored) {
      expect(e.operatorId).toBe('alice')
      expect(e.payload['workerId']).toBe('w-alice-1')
    }
  })

  it('rejects a batch without a valid events array', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const res = await post('/fleet/events', w, { events: [{ entityId: 'x' }] })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /fleet/evidence + detectEvidenceMismatch — CI is the only trust anchor (ADR-0022)', () => {
  it('stores the self-report as fleet.evidence_reported', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const [task] = seedTasks(1)
    const res = await post('/fleet/evidence', w, { taskId: task!.id, selfReport: { gates: { test: true, lint: true } } })
    expect(res.statusCode).toBe(200)
    const events = db.queryEvents({ type: 'fleet.evidence_reported', entityId: task!.id })
    expect(events).toHaveLength(1)
    expect(events[0]?.operatorId).toBe('alice')
    expect((events[0]?.payload['selfReport'] as { gates: Record<string, boolean> }).gates['test']).toBe(true)
  })

  it('does nothing when the self-report matches CI', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const [task] = seedTasks(1)
    await post('/fleet/evidence', w, { taskId: task!.id, selfReport: { gates: { test: true } } })
    const verdict = detectEvidenceMismatch(db, task!.id, { gates: { test: true } })
    expect(verdict.mismatch).toBe(false)
    expect(db.listActiveHolds(task!.id)).toHaveLength(0)
    expect(db.getFleetWorker('w-alice-1')?.status).toBe('active')
  })

  it('forged-evidence drill: self-reported pass vs CI fail freezes the worker and opens HOLD-EVIDENCE-MISMATCH', async () => {
    const w = await registerWorker('w-alice-1', 'alice')
    const [task, other] = seedTasks(2)
    await post('/fleet/evidence', w, { taskId: task!.id, selfReport: { gates: { test: true, lint: true } } })

    const verdict = detectEvidenceMismatch(db, task!.id, { gates: { test: false, lint: true } })
    expect(verdict.mismatch).toBe(true)
    expect(verdict.workerId).toBe('w-alice-1')
    expect(verdict.mismatchedGates).toEqual(['test'])

    const holds = db.listActiveHolds(task!.id)
    expect(holds.some((h) => h.code === 'HOLD-EVIDENCE-MISMATCH')).toBe(true)
    expect(db.queryEvents({ type: 'fleet.worker_frozen', entityId: 'w-alice-1' })).toHaveLength(1)
    expect(db.getFleetWorker('w-alice-1')?.status).toBe('frozen')

    // frozen worker: claims and events are refused with 403
    const claim = await post('/fleet/claim', w, {})
    expect(claim.statusCode).toBe(403)
    expect(claim.json().error).toBe('worker_frozen')
    const ev = await post('/fleet/events', w, { events: [{ type: 'worker.note', payload: {} }] })
    expect(ev.statusCode).toBe(403)
    expect(db.queryEvents({ type: 'worker.note' })).toHaveLength(0)
    expect(other!.id).toBeTruthy()
  })
})

describe('GET /fleet/overview — read-only squad view (v5-P3)', () => {
  it('returns an empty fleet with no workers and no operators', async () => {
    const res = await app.inject({ method: 'GET', url: '/fleet/overview' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ workers: [], operators: [] })
  })

  it('lists two workers with per-operator headless call counts and live claimed tasks', async () => {
    // Align the fake clock with the real wall clock: cost.headless_call
    // events carry a real created_at and the day-window must match.
    nowMs = Date.now()
    const a = await registerWorker('w-alice-1', 'alice')
    await registerWorker('w-bob-1', 'bob')
    const tasks = seedTasks(2)
    const claimed = await post('/fleet/claim', a, {})
    expect(claimed.statusCode).toBe(200)
    recordHeadlessCall(db, null, { role: 'worker', provider: 'claude-cli', operatorId: 'alice' })
    recordHeadlessCall(db, null, { role: 'worker', provider: 'claude-cli', operatorId: 'alice' })
    recordHeadlessCall(db, null, { role: 'worker', provider: 'claude-cli', operatorId: 'bob' })

    const res = await app.inject({ method: 'GET', url: '/fleet/overview' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workers).toHaveLength(2)
    const wAlice = body.workers.find((w: { workerId: string }) => w.workerId === 'w-alice-1')
    const wBob = body.workers.find((w: { workerId: string }) => w.workerId === 'w-bob-1')
    expect(wAlice.operatorId).toBe('alice')
    expect(wAlice.status).toBe('active')
    expect(wAlice.lastSeenAt).toBe(new Date(nowMs).toISOString())
    expect(wAlice.claimedTaskIds).toEqual([tasks[0]!.id])
    expect(wBob.claimedTaskIds).toEqual([])
    const ops = Object.fromEntries(body.operators.map((o: { operatorId: string }) => [o.operatorId, o]))
    expect(ops['alice'].headlessCallsToday).toBe(2)
    expect(ops['bob'].headlessCallsToday).toBe(1)
    expect(ops['alice'].activeHolds).toEqual([])
    expect(ops['bob'].activeHolds).toEqual([])
  })

  it('shows a frozen worker as frozen and attributes HOLD-EVIDENCE-MISMATCH to its operator', async () => {
    nowMs = Date.now()
    const w = await registerWorker('w-alice-1', 'alice')
    const [task] = seedTasks(1)
    await post('/fleet/evidence', w, { taskId: task!.id, selfReport: { gates: { test: true } } })
    detectEvidenceMismatch(db, task!.id, { gates: { test: false } })

    const body = (await app.inject({ method: 'GET', url: '/fleet/overview' })).json()
    expect(body.workers[0].status).toBe('frozen')
    const alice = body.operators.find((o: { operatorId: string }) => o.operatorId === 'alice')
    expect(alice.activeHolds.some(
      (h: { code: string; entityId: string }) => h.code === 'HOLD-EVIDENCE-MISMATCH' && h.entityId === task!.id,
    )).toBe(true)
  })

  it('is read-only: no auth headers needed, no write-action fields, no key material', async () => {
    nowMs = Date.now()
    const w = await registerWorker('w-alice-1', 'alice')
    recordHeadlessCall(db, null, { role: 'worker', provider: 'claude-cli', operatorId: 'alice' })
    // GET without any x-worker-id/x-signature headers: owner's local cockpit.
    const res = await app.inject({ method: 'GET', url: '/fleet/overview' })
    expect(res.statusCode).toBe(200)
    // never echo key material — the registered public key must not appear
    expect(res.body).not.toContain(w.publicKey)
    const body = res.json()
    expect(Object.keys(body).sort()).toEqual(['operators', 'workers'])
    expect(Object.keys(body.workers[0]).sort()).toEqual(
      ['claimedTaskIds', 'lastSeenAt', 'operatorId', 'status', 'workerId'],
    )
    expect(Object.keys(body.operators[0]).sort()).toEqual(
      ['activeHolds', 'headlessCallsToday', 'operatorId'],
    )
  })
})

describe('POST /fleet/claim — per-operator budget HOLD (v5-P3)', () => {
  const DAY_CAP_KEY = 'AEDEV_BUDGET_MAX_HEADLESS_PER_DAY'
  let savedDayCap: string | undefined
  beforeEach(() => {
    savedDayCap = process.env[DAY_CAP_KEY]
    process.env[DAY_CAP_KEY] = '2'
    nowMs = Date.now() // headless-call events use the real clock's UTC day
  })
  afterEach(() => {
    if (savedDayCap === undefined) delete process.env[DAY_CAP_KEY]
    else process.env[DAY_CAP_KEY] = savedDayCap
  })

  function burnAliceDayBudget(): void {
    recordHeadlessCall(db, null, { role: 'worker', provider: 'claude-cli', operatorId: 'alice' })
    recordHeadlessCall(db, null, { role: 'worker', provider: 'claude-cli', operatorId: 'alice' })
  }

  it('refuses an over-budget operator claim with 429 + HOLD-BUDGET and assigns no task', async () => {
    const a = await registerWorker('w-alice-1', 'alice')
    seedTasks(1)
    burnAliceDayBudget()
    const res = await post('/fleet/claim', a, {})
    expect(res.statusCode).toBe(429)
    expect(res.json().error).toBe('budget_exceeded')
    expect(res.json().holdCode).toBe(HOLD_BUDGET_CODE)
    expect(db.queryEvents({ type: 'fleet.task_claimed' })).toHaveLength(0)
    const holds = db.listActiveHolds('fleet:alice')
    expect(holds.some((h) => h.code === HOLD_BUDGET_CODE)).toBe(true)
    // the hold is visible in the read-only overview, attributed to alice
    const overview = (await app.inject({ method: 'GET', url: '/fleet/overview' })).json()
    const alice = overview.operators.find((o: { operatorId: string }) => o.operatorId === 'alice')
    expect(alice.activeHolds.some((h: { code: string }) => h.code === HOLD_BUDGET_CODE)).toBe(true)
  })

  it("another operator's worker still claims fine while the first is over budget", async () => {
    const a = await registerWorker('w-alice-1', 'alice')
    const b = await registerWorker('w-bob-1', 'bob')
    const tasks = seedTasks(1)
    burnAliceDayBudget()
    expect((await post('/fleet/claim', a, {})).statusCode).toBe(429)
    const resB = await post('/fleet/claim', b, {})
    expect(resB.statusCode).toBe(200)
    expect(resB.json().task.id).toBe(tasks[0]!.id)
    expect(db.listActiveHolds('fleet:bob')).toHaveLength(0)
  })
})

describe('wiring + ground rules', () => {
  it('createServer exposes the fleet routes', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'aedev-fleet-'))
    const server = createServer(db, new Date(), stateDir)
    try {
      const res = await server.inject({
        method: 'POST', url: '/fleet/register',
        payload: { workerId: 'w-srv', operatorId: 'alice', publicKey: makeKeys().publicKey },
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await server.close()
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it('GROUND RULE 8: fleet daemon sources never import child_process', () => {
    const sources = ['./fleet.ts', '../fleet/signing.ts', '../fleet/auth.ts', '../fleet/claims.ts', '../fleet/overview.ts']
    for (const rel of sources) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
      expect(src.includes('child_process'), `${rel} must not touch child_process`).toBe(false)
    }
  })

  it('canonicalJson is key-order independent (signature stability across JSON serializers)', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 3, e: 4 }], c: null } }))
      .toBe(canonicalJson({ a: { c: null, d: [2, { e: 4, f: 3 }] }, b: 1 }))
  })
})
