import { describe, it, expect } from 'vitest'
import { generateFleetKeyPairHex, verifyFleetSignature, type Task } from '@aedev/core'
import {
  FleetWorkerAgent,
  scrubCredentialFields,
  type FleetFetchFn,
  type FleetLoopResult,
} from './fleet-worker.js'

const KEYS = generateFleetKeyPairHex()

function task(id = 'task-1'): Task {
  return {
    id, missionId: 'm1', repoId: 'r1', title: 't', prompt: 'do it',
    status: 'pending', attemptNumber: 0, createdAt: '2026-06-10T00:00:00.000Z', updatedAt: '2026-06-10T00:00:00.000Z',
  } as Task
}

interface Captured { url: string; headers: Record<string, string>; body: string }

/** Canned-response fake server; records every request the agent makes. */
function fakeServer(responses: Record<string, Array<{ status: number; body: unknown }>>) {
  const calls: Captured[] = []
  const fetchFn: FleetFetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body })
    const path = new URL(url).pathname
    const queue = responses[path] ?? []
    const next = queue.length > 1 ? queue.shift()! : queue[0] ?? { status: 200, body: { ok: true } }
    return { status: next.status, json: async () => next.body }
  }
  return { calls, fetchFn }
}

function agent(fetchFn: FleetFetchFn, executor = async () => ({ exitCode: 0, evidence: {} })) {
  return new FleetWorkerAgent({
    baseUrl: 'http://coordinator.local:7777',
    workerId: 'w-alice-1',
    operatorId: 'alice',
    privateKeyHex: KEYS.privateKeyHex,
    publicKeyHex: KEYS.publicKeyHex,
    executor,
    fetchFn,
  })
}

describe('FleetWorkerAgent — identity', () => {
  it('refuses a publicKeyHex that does not match the private key (split identity)', () => {
    const other = generateFleetKeyPairHex()
    expect(() => agent(fakeServer({}).fetchFn) /* sane */).not.toThrow()
    expect(() => new FleetWorkerAgent({
      baseUrl: 'http://x', workerId: 'w', operatorId: 'o',
      privateKeyHex: KEYS.privateKeyHex, publicKeyHex: other.publicKeyHex,
      executor: async () => ({ exitCode: 0, evidence: {} }),
    })).toThrow(/does not match/)
  })

  it('register() posts the unsigned identity body; signed calls verify against the registered key', async () => {
    const srv = fakeServer({
      '/fleet/register': [{ status: 200, body: { workerId: 'w-alice-1', operatorId: 'alice', status: 'active' } }],
      '/fleet/claim': [{ status: 200, body: { task: null } }],
    })
    const a = agent(srv.fetchFn)
    expect(await a.register()).toEqual({ ok: true, httpStatus: 200 })
    expect(await a.runOnce()).toEqual({ status: 'idle' })

    const reg = srv.calls.find((c) => c.url.includes('/fleet/register'))!
    expect(JSON.parse(reg.body)).toEqual({ workerId: 'w-alice-1', operatorId: 'alice', publicKey: KEYS.publicKeyHex })
    expect(reg.headers['x-signature']).toBeUndefined()

    const claim = srv.calls.find((c) => c.url.includes('/fleet/claim'))!
    expect(verifyFleetSignature(
      KEYS.publicKeyHex,
      JSON.parse(claim.body),
      claim.headers['x-nonce']!,
      claim.headers['x-sent-at']!,
      claim.headers['x-signature']!,
    )).toBe(true)
    expect(claim.headers['x-worker-id']).toBe('w-alice-1')
  })
})

describe('FleetWorkerAgent — RED LINE: no credentials, no key material on the wire', () => {
  it('scrubCredentialFields drops credential-shaped keys at any depth', () => {
    expect(scrubCredentialFields({
      ok: 1, apiKey: 'sk-x', nested: { gh_token: 'ghp', list: [{ clientSecret: 's', keep: true }] },
    })).toEqual({ ok: 1, nested: { list: [{ keep: true }] } })
  })

  it('scrubs executor evidence client-side and never sends the private key anywhere', async () => {
    const srv = fakeServer({
      '/fleet/claim': [{ status: 200, body: { task: task() } }],
    })
    const a = agent(srv.fetchFn, async () => ({
      exitCode: 0,
      evidence: { 'note.md': 'fine', apiKey: 'sk-leak', GH_TOKEN: 'ghp_leak' },
      gates: { test: true },
    }))
    const out = await a.runOnce()
    expect(out.status).toBe('completed')
    expect(srv.calls.length).toBeGreaterThanOrEqual(4)
    for (const call of srv.calls) {
      const wire = call.body + JSON.stringify(call.headers)
      expect(wire).not.toContain(KEYS.privateKeyHex)
      expect(wire).not.toMatch(/sk-leak|ghp_leak/)
      for (const key of Object.keys(flatten(JSON.parse(call.body)))) {
        expect(key).not.toMatch(/token|api[_-]?key|secret/i)
      }
    }
    // the scrub happens BEFORE signing, so the sent body still verifies
    const evidence = srv.calls.find((c) => c.url.includes('/fleet/evidence'))!
    expect(verifyFleetSignature(
      KEYS.publicKeyHex, JSON.parse(evidence.body),
      evidence.headers['x-nonce']!, evidence.headers['x-sent-at']!, evidence.headers['x-signature']!,
    )).toBe(true)
  })
})

describe('FleetWorkerAgent — runOnce / runLoop behaviour', () => {
  it('a failing executor still reports evidence with exitCode 1 instead of throwing', async () => {
    const srv = fakeServer({ '/fleet/claim': [{ status: 200, body: { task: task() } }] })
    const a = agent(srv.fetchFn, async () => { throw new Error('cli exploded') })
    const out = await a.runOnce()
    expect(out).toMatchObject({ status: 'completed', taskId: 'task-1', exitCode: 1, reportErrors: [] })
    const evidence = srv.calls.find((c) => c.url.includes('/fleet/evidence'))!
    expect(JSON.parse(evidence.body).selfReport.evidence['executor-error.md']).toContain('cli exploded')
  })

  it('a refused claim (403 worker_frozen) surfaces as a result, not an exception', async () => {
    const srv = fakeServer({ '/fleet/claim': [{ status: 403, body: { error: 'worker_frozen' } }] })
    const out = await agent(srv.fetchFn).runOnce()
    expect(out).toEqual({ status: 'refused', httpStatus: 403, code: 'worker_frozen' })
  })

  it('runLoop polls, surfaces refusals via onResult without crashing, and stops on the stop signal', async () => {
    const srv = fakeServer({
      '/fleet/claim': [
        { status: 200, body: { task: null } },
        { status: 403, body: { error: 'worker_frozen' } },
      ],
    })
    const results: FleetLoopResult[] = []
    let stop!: () => void
    const stopSignal = new Promise<void>((r) => { stop = r })
    const loop = agent(srv.fetchFn).runLoop({
      intervalMs: 1,
      stopSignal,
      onResult: (r) => {
        results.push(r)
        if (results.length >= 2) stop()
      },
    })
    await loop // resolves => the stop signal interrupted the sleep
    expect(results[0]).toEqual({ status: 'idle' })
    expect(results[1]).toEqual({ status: 'refused', httpStatus: 403, code: 'worker_frozen' })
  })

  it('runLoop turns transport errors into { status: "error" } results and keeps going', async () => {
    let n = 0
    const failingFetch: FleetFetchFn = async () => {
      n++
      if (n === 1) throw new Error('ECONNREFUSED coordinator.local')
      return { status: 200, json: async () => ({ task: null }) }
    }
    const results: FleetLoopResult[] = []
    let stop!: () => void
    const stopSignal = new Promise<void>((r) => { stop = r })
    await agent(failingFetch).runLoop({
      intervalMs: 1,
      stopSignal,
      onResult: (r) => {
        results.push(r)
        if (results.length >= 2) stop()
      },
    })
    expect(results[0]).toMatchObject({ status: 'error', message: expect.stringContaining('ECONNREFUSED') })
    expect(results[1]).toEqual({ status: 'idle' })
  })
})

function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[prefix ? `${prefix}.${k}` : k] = v
    flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}
