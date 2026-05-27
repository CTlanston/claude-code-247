/** CC_RESTORE_SPEC T2 — tests for the real-bindings smoke harness.
 *  Uses an in-process fake fetch so no daemon is required at test time. */
import { describe, it, expect } from 'vitest'
import { realChecks, type RealEnv } from './launch-smoke-real.js'
import { SmokeHarness } from './launch-smoke.js'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

type FetchInput = string | URL | Request
type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>

function makeFetch(handler: FetchHandler): typeof globalThis.fetch {
  return (async (input: FetchInput, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return handler(url, init)
  }) as unknown as typeof globalThis.fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'real-smoke-'))
}

describe('launch-smoke-real · realChecks (CC_RESTORE_SPEC T2)', () => {
  it('case 1: check 1 (/health) → pass when daemon returns status=green', async () => {
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async (url) => {
        if (url.endsWith('/health')) return json({ status: 'green' })
        throw new Error('unexpected url ' + url)
      }),
    }
    const checks = realChecks({ env })
    expect(checks).toHaveLength(7)
    const out = await checks[0].run()
    expect(out.detail).toMatchObject({ status: 'green' })
  })

  it('case 2: check 1 → throws when /health stays non-green past window', async () => {
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async () => json({ status: 'yellow' }, 200)),
    }
    const checks = realChecks({ env })
    // Race the check against a synthetic 1s budget by wrapping in Promise.race.
    const racer = Promise.race([
      checks[0].run().then(() => 'pass'),
      new Promise<string>((res) => setTimeout(() => res('timeout'), 200)),
    ])
    expect(await racer).toBe('timeout')
  })

  it('case 3: check 2 — scan → mission → polls roadmap.proposal.emitted', async () => {
    let pollCount = 0
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async (url, init) => {
        if (url.endsWith('/missions/scan') && init?.method === 'POST') {
          return json({ taskId: 'task_scan_42' })
        }
        if (url.includes('/events?taskId=task_scan_42')) {
          pollCount++
          // First poll returns no events; second returns the emit event.
          if (pollCount >= 2) {
            return json({
              events: [
                { id: 'evt_01XYZ', kind: 'roadmap.proposal.emitted', payload: { proposalId: 'p1' } },
              ],
            })
          }
          return json({ events: [] })
        }
        throw new Error('unexpected url ' + url)
      }),
    }
    const checks = realChecks({ env })
    const out = await checks[1].run()
    expect(out.detail).toMatchObject({ taskId: 'task_scan_42', eventId: 'evt_01XYZ' })
  }, 10_000)

  it('case 4: check 3 requires env.approveOnPhone (operator-only)', async () => {
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async () => json({ missionId: 'm1' })),
      // approveOnPhone omitted
    }
    const checks = realChecks({ env })
    await expect(checks[2].run()).rejects.toThrow(/operator-supplied callback/)
  })

  it('case 5: check 5 (sentinel probe) → pass on hard_block + event', async () => {
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async (url, init) => {
        if (url.endsWith('/sentinel/probe') && init?.method === 'POST') {
          return json({ verdict: 'hard_block', taskId: 'task_red_42' })
        }
        if (url.includes('/events?taskId=task_red_42')) {
          return json({
            events: [
              { id: 'evt_red42', kind: 'sentinel.tool_call.hardblocked', payload: { reason: 'env_or_secrets_read' } },
            ],
          })
        }
        throw new Error('unexpected url ' + url)
      }),
    }
    const checks = realChecks({ env })
    const out = await checks[4].run()
    expect(out.detail).toMatchObject({ taskId: 'task_red_42', eventId: 'evt_red42' })
  })

  it('case 6: check 5 → throws when sentinel returns allow (anti-paper-pass)', async () => {
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async (url) => {
        if (url.endsWith('/sentinel/probe')) return json({ verdict: 'allow', taskId: 'task_x' })
        throw new Error('unexpected url ' + url)
      }),
    }
    const checks = realChecks({ env })
    await expect(checks[4].run()).rejects.toThrow(/expected hard_block, got allow/)
  })

  it('case 7: check 7 (telemetry triple) → pass when event id on SSE + prom + loki', async () => {
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async (url) => {
        if (url.endsWith('/events?limit=1')) {
          return json({ events: [{ id: 'evt_telemetry_x' }] })
        }
        if (url.includes('/events/stream')) {
          return new Response('id: evt_telemetry_x\nevent: task.run.advanced\ndata: {"id":"evt_telemetry_x"}\n\n')
        }
        if (url.endsWith('/metrics')) {
          return new Response('events_total{kind="task.run.advanced",id="evt_telemetry_x"} 1\n')
        }
        if (url.includes('/loki/recent')) {
          return new Response('{"id":"evt_telemetry_x","kind":"task.run.advanced"}')
        }
        throw new Error('unexpected url ' + url)
      }),
    }
    const checks = realChecks({ env })
    const out = await checks[6].run()
    expect(out.detail).toMatchObject({ eventId: 'evt_telemetry_x' })
    expect((out.detail as { planes: string[] }).planes.sort()).toEqual(['loki', 'prom', 'sse'])
  })

  it('case 8: check 7 → throws if fewer than 3 planes see the id', async () => {
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async (url) => {
        if (url.endsWith('/events?limit=1')) {
          return json({ events: [{ id: 'evt_partial' }] })
        }
        if (url.includes('/events/stream')) {
          return new Response('id: evt_partial\n')
        }
        // /metrics + /loki return without the id
        if (url.endsWith('/metrics')) {
          return new Response('# nothing\n')
        }
        if (url.includes('/loki/recent')) {
          return new Response('')
        }
        throw new Error('unexpected url ' + url)
      }),
    }
    const checks = realChecks({ env })
    await expect(checks[6].run()).rejects.toThrow(/not visible on all 3 planes/)
  })

  it('case 9: harness integration — real checks 1+2+5+7 in synthetic-headless mode pass via SmokeHarness', async () => {
    // Drop checks 3, 4, 6 (need operator + dispatch chain).
    const env: RealEnv = {
      daemonUrl: 'http://127.0.0.1:7247',
      fetch: makeFetch(async (url, init) => {
        if (url.endsWith('/health')) return json({ status: 'green' })
        if (url.endsWith('/missions/scan')) return json({ taskId: 't_scan' })
        if (url.includes('/events?taskId=t_scan')) {
          return json({ events: [{ id: 'evt_s', kind: 'roadmap.proposal.emitted', payload: {} }] })
        }
        if (url.endsWith('/sentinel/probe')) return json({ verdict: 'hard_block', taskId: 't_red' })
        if (url.includes('/events?taskId=t_red')) {
          return json({ events: [{ id: 'evt_r', kind: 'sentinel.tool_call.hardblocked', payload: {} }] })
        }
        if (url.endsWith('/events?limit=1')) return json({ events: [{ id: 'evt_T' }] })
        if (url.includes('/events/stream')) return new Response('id: evt_T\n')
        if (url.endsWith('/metrics')) return new Response('id="evt_T"\n')
        if (url.includes('/loki/recent')) return new Response('"id":"evt_T"')
        if (url.includes('/sentinel') || url.includes('/missions')) return json({}, 200)
        void init
        return new Response('', { status: 404 })
      }),
    }
    const all = realChecks({ env })
    const subset = all.filter((c) => [1, 2, 5, 7].includes(c.id))
    const dir = await tmpDir()
    const harness = new SmokeHarness({
      mode: 'real',
      checks: subset,
      evidenceDir: dir,
    })
    const report = await harness.run()
    expect(report.pass_count).toBe(4)
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true)
  }, 30_000)
})
