/**
 * v5 fleet worker agent ⇄ coordinator integration (ADR-0023 §5).
 *
 * Drives the REAL fleet routes with the real FleetWorkerAgent from
 * @aedev/runner via fastify inject. The test lives on the daemon side
 * because the dependency direction is daemon → runner; a runner-side test
 * importing the daemon would invert it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { AedevDb, generateFleetKeyPairHex, type Task } from '@aedev/core'
import { FleetWorkerAgent, type FleetExecutor, type FleetFetchFn, type FleetLoopResult } from '@aedev/runner'
import { registerFleetRoutes } from '../routes/fleet.js'
import { type FleetClock } from './auth.js'
import { detectEvidenceMismatch } from './claims.js'

const T0 = Date.parse('2026-06-10T08:00:00.000Z')

let db: AedevDb
let app: FastifyInstance
let nowMs: number
const clock: FleetClock = { now: () => nowMs }

/** Bridge the agent's fetch onto the in-process fastify app — real routes, no TCP. */
const injectFetch: FleetFetchFn = async (url, init) => {
  const res = await app.inject({ method: 'POST', url: new URL(url).pathname, headers: init.headers, payload: init.body })
  return { status: res.statusCode, json: async () => res.json() as unknown }
}

function seedTask(): Task {
  const repo = db.insertRepo({
    name: `fleet-repo-${randomUUID().slice(0, 8)}`, path: '/tmp/fleet-repo', defaultBranch: 'main',
    enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
  const mission = db.insertMission({ repoId: repo.id, title: 'fleet mission', status: 'approved' })
  return db.insertTask({
    missionId: mission.id, repoId: repo.id, title: 't0', prompt: 'do 0',
    status: 'pending', attemptNumber: 0,
  })
}

function makeAgent(keys = generateFleetKeyPairHex(), executor: FleetExecutor = defaultExecutor) {
  return new FleetWorkerAgent({
    baseUrl: 'http://coordinator.local',
    workerId: 'w-alice-1',
    operatorId: 'alice',
    privateKeyHex: keys.privateKeyHex,
    publicKeyHex: keys.publicKeyHex,
    executor,
    clock,
    fetchFn: injectFetch,
  })
}

const defaultExecutor = async (task: Task) => ({
  exitCode: 0,
  evidence: { 'test-summary.md': `task ${task.id}: all gates green` },
  gates: { test: true, lint: true },
})

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

describe('FleetWorkerAgent against the real fleet routes', () => {
  it('full happy path: register → claim → execute(fake) → evidence + events → heartbeat', async () => {
    const task = seedTask()
    const agent = makeAgent()
    expect(await agent.register()).toEqual({ ok: true, httpStatus: 200 })
    expect(db.getFleetWorker('w-alice-1')?.operatorId).toBe('alice')

    const out = await agent.runOnce()
    expect(out).toEqual({ status: 'completed', taskId: task.id, exitCode: 0, reportErrors: [] })

    // claim is on the ledger, bound to the registry identity
    const claims = db.queryEvents({ type: 'fleet.task_claimed', entityId: task.id })
    expect(claims).toHaveLength(1)
    expect(claims[0]?.payload['workerId']).toBe('w-alice-1')
    expect(claims[0]?.operatorId).toBe('alice')

    // self-report evidence landed (reference only — CI stays the anchor)
    const evidence = db.queryEvents({ type: 'fleet.evidence_reported', entityId: task.id })
    expect(evidence).toHaveLength(1)
    const selfReport = evidence[0]?.payload['selfReport'] as { gates: Record<string, boolean> }
    expect(selfReport.gates).toEqual({ test: true, lint: true })

    // lifecycle events ingested with worker provenance
    for (const type of ['worker.task_started', 'worker.task_finished']) {
      const events = db.queryEvents({ type, entityId: task.id })
      expect(events).toHaveLength(1)
      expect(events[0]?.payload['workerId']).toBe('w-alice-1')
      expect(events[0]?.operatorId).toBe('alice')
    }

    // heartbeat refreshed liveness
    expect(db.getFleetWorker('w-alice-1')?.lastSeenAt).toBe(new Date(nowMs).toISOString())

    // a matching CI result raises no mismatch on this honest run
    expect(detectEvidenceMismatch(db, task.id, { gates: { test: true, lint: true } }).mismatch).toBe(false)

    // next pass with nothing pending is idle
    expect(await agent.runOnce()).toEqual({ status: 'idle' })
  })

  it('signature from a non-registered key is rejected: refused bad_signature, nothing claimed', async () => {
    seedTask()
    // the server knows key A…
    expect((await makeAgent().register()).ok).toBe(true)
    // …but this agent signs with its own different key B for the same workerId
    const impostor = makeAgent(generateFleetKeyPairHex())
    expect(await impostor.register()).toEqual({ ok: false, httpStatus: 409, code: 'worker_exists' })

    const out = await impostor.runOnce()
    expect(out).toEqual({ status: 'refused', httpStatus: 401, code: 'bad_signature' })
    expect(db.queryEvents({ type: 'fleet.task_claimed' })).toHaveLength(0)
    const rejected = db.queryEvents({ type: 'fleet.rejected_event' })
    expect(rejected.some((e) => String(e.payload['reason']).includes('bad_signature'))).toBe(true)
  })

  it('a frozen worker gets 403 and the loop surfaces it without crashing', async () => {
    seedTask()
    const agent = makeAgent()
    expect((await agent.register()).ok).toBe(true)
    db.setFleetWorkerStatus('w-alice-1', 'frozen')

    const results: FleetLoopResult[] = []
    let stop!: () => void
    const stopSignal = new Promise<void>((r) => { stop = r })
    await agent.runLoop({
      intervalMs: 1,
      stopSignal,
      onResult: (r) => {
        results.push(r)
        if (results.length >= 2) stop()
      },
    })
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r).toEqual({ status: 'refused', httpStatus: 403, code: 'worker_frozen' })
    }
    expect(db.queryEvents({ type: 'fleet.task_claimed' })).toHaveLength(0)
  })

  it('client-side scrub keeps a credential-leaking executor inside the red line end-to-end', async () => {
    const task = seedTask()
    const agent = makeAgent(generateFleetKeyPairHex(), async () => ({
      exitCode: 0,
      evidence: { 'note.md': 'done', apiKey: 'sk-leak', GH_TOKEN: 'ghp_leak' },
      gates: { test: true },
    }))
    expect((await agent.register()).ok).toBe(true)
    // Without the scrub the server would 400 credential_field_forbidden;
    // with it the run completes and nothing credential-shaped is stored.
    const out = await agent.runOnce()
    expect(out).toEqual({ status: 'completed', taskId: task.id, exitCode: 0, reportErrors: [] })
    const stored = db.queryEvents({ type: 'fleet.evidence_reported', entityId: task.id })
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored[0]?.payload)).not.toMatch(/sk-leak|ghp_leak|apiKey|GH_TOKEN/)
  })
})
