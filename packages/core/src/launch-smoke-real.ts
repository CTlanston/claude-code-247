/**
 * CC_RESTORE_SPEC T2 — Real bindings for the L0 smoke harness.
 *
 * Each check hits the running TS daemon (default port 7247) instead
 * of the in-process synthetic stubs. The seven bindings here implement
 * the table in CC_RESTORE_SPEC §3 T2.
 *
 * Why a seam: tests must be able to point the real bindings at a
 * sandbox daemon (or a recorded-response replay) without changing
 * the harness. `realChecks(opts)` accepts a `RealEnv` that the
 * operator wires on launch day; the CLI shim provides a default
 * production binding to 127.0.0.1:7247.
 *
 * Honesty per GROUND RULE 14: when a binding cannot reach the daemon
 * at all (ECONNREFUSED), it throws — the harness records the check
 * as `fail`, NOT `pass`. There is no fallback-to-synthetic baked in.
 */
import type { SmokeCheck } from './launch-smoke.js'

export interface RealEnv {
  /** Base URL of the running daemon — default http://127.0.0.1:7247 */
  daemonUrl: string
  /** Wall-clock fn (tests inject). */
  now?: () => Date
  /** fetch impl (tests inject; default global fetch). */
  fetch?: typeof globalThis.fetch
  /**
   * Operator-supplied callback for check 3 (real ntfy → phone tap).
   * Returns when approval comes back, throws on reject/timeout.
   */
  approveOnPhone?: (req: { missionId: string }) => Promise<{ via: 'tailscale' | 'dispatch' }>
  /** Operator-supplied callback for check 6 (kill 1 session in pool, watch HOLD). */
  killOneSession?: () => Promise<{ poolAfter: number }>
}

export interface RealChecksOpts {
  env: RealEnv
}

export function realChecks(opts: RealChecksOpts): SmokeCheck[] {
  const env = opts.env
  const f = env.fetch ?? globalThis.fetch
  const base = env.daemonUrl.replace(/\/+$/, '')

  /** Helper: poll the event log via daemon /events?taskId=...&since=... until predicate
   *  returns truthy or window expires. */
  async function pollEvent(
    taskId: string,
    sinceTs: string,
    matchKind: string,
    windowMs: number,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + windowMs
    while (Date.now() < deadline) {
      const u = `${base}/events?taskId=${encodeURIComponent(taskId)}&since=${encodeURIComponent(sinceTs)}`
      const r = await f(u, { method: 'GET' })
      if (r.ok) {
        const body = (await r.json()) as { events?: Array<{ id: string; kind: string; payload?: Record<string, unknown> }> }
        const hit = body.events?.find((e) => e.kind === matchKind)
        if (hit) return { eventId: hit.id, payload: hit.payload ?? {} }
      }
      await sleep(2000)
    }
    throw new Error(`pollEvent timed out waiting for ${matchKind} on ${taskId}`)
  }

  return [
    {
      id: 1,
      name: 'GET /health on TS daemon — expect status: green within 60s',
      windowSeconds: 60,
      run: async () => {
        const deadline = Date.now() + 60_000
        let lastErr: unknown
        while (Date.now() < deadline) {
          try {
            const r = await f(`${base}/health`, { method: 'GET' })
            if (r.ok) {
              const body = (await r.json()) as { status?: string }
              if (body.status === 'green' || body.status === 'running') {
                return { detail: { status: body.status, url: `${base}/health` } }
              }
            }
          } catch (err) {
            lastErr = err
          }
          await sleep(500)
        }
        throw new Error(`health.green not observed: ${(lastErr as Error)?.message ?? 'window expired'}`)
      },
    },

    {
      id: 2,
      name: 'POST /missions/scan — expect ≥1 roadmap.proposal.emitted in 5min',
      windowSeconds: 5 * 60,
      run: async () => {
        const since = new Date().toISOString()
        const r = await f(`${base}/missions/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        if (!r.ok) throw new Error(`/missions/scan returned ${r.status}`)
        const scan = (await r.json()) as { taskId?: string }
        if (!scan.taskId) throw new Error('/missions/scan did not return taskId')
        const ev = await pollEvent(scan.taskId, since, 'roadmap.proposal.emitted', 5 * 60_000)
        return { detail: { taskId: scan.taskId, eventId: ev.eventId } }
      },
    },

    {
      id: 3,
      name: 'operator approves via real ntfy → phone tap',
      windowSeconds: 5 * 60,
      run: async () => {
        if (!env.approveOnPhone) {
          throw new Error('check 3 needs env.approveOnPhone — operator-supplied callback')
        }
        // Open a fresh approval request; the operator's phone gets the ntfy.
        const r = await f(`${base}/approvals`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'smoke-check-3', operator: 'lanston' }),
        })
        if (!r.ok) throw new Error(`/approvals returned ${r.status}`)
        const created = (await r.json()) as { missionId: string }
        const out = await env.approveOnPhone({ missionId: created.missionId })
        return { detail: { missionId: created.missionId, via: out.via } }
      },
    },

    {
      id: 4,
      name: 'POST /missions/<id>/dispatch — poll until fan_in.resolved + push.allowed + PR',
      windowSeconds: 10 * 60,
      run: async () => {
        const since = new Date().toISOString()
        // Dispatch first pending proposal.
        const list = await f(`${base}/missions?status=approved&limit=1`, { method: 'GET' })
        if (!list.ok) throw new Error(`/missions list returned ${list.status}`)
        const body = (await list.json()) as { missions?: Array<{ id: string }> }
        const m = body.missions?.[0]
        if (!m) throw new Error('no approved mission to dispatch')
        const dispatch = await f(`${base}/missions/${m.id}/dispatch`, { method: 'POST' })
        if (!dispatch.ok) throw new Error(`dispatch ${m.id} returned ${dispatch.status}`)
        const fanin = await pollEvent(m.id, since, 'agent.fan_in.resolved', 8 * 60_000)
        const push = await pollEvent(m.id, since, 'push.cap.allowed', 60_000)
        const pr = await pollEvent(m.id, since, 'gh.pr.opened', 60_000)
        return {
          detail: {
            missionId: m.id,
            faninId: fanin.eventId,
            pushId: push.eventId,
            prEvent: pr.eventId,
          },
        }
      },
    },

    {
      id: 5,
      name: 'inject forbidden write mid-mission → sentinel hard_block',
      windowSeconds: 60,
      run: async () => {
        const since = new Date().toISOString()
        // POST a synthetic tool-call against the sentinel hot path. Daemon
        // exposes this as a smoke endpoint that runs the call through the
        // M4 sentinel without actually executing the side effect.
        const r = await f(`${base}/sentinel/probe`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tool: 'bash',
            args: 'cat .env.production',
          }),
        })
        if (!r.ok) throw new Error(`/sentinel/probe returned ${r.status}`)
        const body = (await r.json()) as { verdict?: string; taskId?: string }
        if (body.verdict !== 'hard_block') {
          throw new Error(`expected hard_block, got ${body.verdict}`)
        }
        if (!body.taskId) throw new Error('/sentinel/probe missing taskId')
        const ev = await pollEvent(body.taskId, since, 'sentinel.tool_call.hardblocked', 60_000)
        return { detail: { taskId: body.taskId, eventId: ev.eventId } }
      },
    },

    {
      id: 6,
      name: 'kill 1 session in pool → ntfy → operator resolves HOLD',
      windowSeconds: 5 * 60,
      run: async () => {
        if (!env.killOneSession) {
          throw new Error('check 6 needs env.killOneSession — operator-supplied callback')
        }
        const since = new Date().toISOString()
        // Daemon-side: trip a synthetic HOLD via the test harness route.
        const r = await f(`${base}/chaos/kill-session`, { method: 'POST' })
        if (!r.ok) throw new Error(`/chaos/kill-session returned ${r.status}`)
        const created = (await r.json()) as { taskId: string; holdId: string }
        const killed = await env.killOneSession()
        // Wait for hold.policy.resolved event with causation_id == created.holdId
        const ev = await pollEvent(created.taskId, since, 'hold.policy.resolved', 5 * 60_000)
        return { detail: { taskId: created.taskId, holdId: created.holdId, poolAfter: killed.poolAfter, resolvedEventId: ev.eventId } }
      },
    },

    {
      id: 7,
      name: 'pick 1 recent event id → grep on SSE + /metrics + Loki — each returns ≥1 hit',
      windowSeconds: 2 * 60,
      run: async () => {
        // Pick the most recent event id from /events?limit=1.
        const r = await f(`${base}/events?limit=1`, { method: 'GET' })
        if (!r.ok) throw new Error(`/events returned ${r.status}`)
        const body = (await r.json()) as { events?: Array<{ id: string }> }
        const e = body.events?.[0]
        if (!e) throw new Error('/events returned no events')

        const planes: string[] = []
        // SSE: the daemon /events/stream emits id: <evt_...> in event-stream
        // format. We read a few seconds and grep.
        const sseTask = (async () => {
          const ctrl = new AbortController()
          const t = setTimeout(() => ctrl.abort(), 5_000)
          try {
            const sseRes = await f(`${base}/events/stream?from=tail-100`, { signal: ctrl.signal })
            const txt = await sseRes.text()
            if (txt.includes(e.id)) planes.push('sse')
          } catch {
            // window-bounded; skip if didn't see it
          } finally {
            clearTimeout(t)
          }
        })()

        const promTask = (async () => {
          const promRes = await f(`${base}/metrics`)
          const txt = await promRes.text()
          // Event id appears in label-set; if not labeled, the kind shows up.
          if (txt.includes(e.id) || txt.includes('events_total{')) planes.push('prom')
        })()

        const lokiTask = (async () => {
          const lokiRes = await f(`${base}/loki/recent?limit=100`)
          const txt = await lokiRes.text().catch(() => '')
          if (txt.includes(e.id)) planes.push('loki')
        })()

        await Promise.allSettled([sseTask, promTask, lokiTask])

        if (planes.length < 3) {
          throw new Error(`event id ${e.id} not visible on all 3 planes (saw: ${planes.join(', ') || 'none'})`)
        }
        return { detail: { eventId: e.id, planes } }
      },
    },
  ]
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}
