/**
 * v5 fleet worker agent (ADR-0023 §5, WORKBOOK v5 proposal §P2/P4).
 *
 * Runs on a member's machine and speaks the coordinator's fleet protocol:
 *
 *   register()  POST /fleet/register   (the only unsigned call)
 *   runOnce()   POST /fleet/claim → execute via the injected executor →
 *               POST /fleet/evidence (self-report, reference only — the
 *               CI-on-PR result stays the trust anchor) →
 *               POST /fleet/events (task lifecycle) → POST /fleet/heartbeat
 *   runLoop()   polling loop with an interruptible sleep (same stop-signal
 *               pattern as the daemon watchdog)
 *
 * Every signed request uses the shared canonical-JSON ed25519 contract from
 * @aedev/core (fleet-signing) — byte-identical to what the coordinator
 * verifies, with fresh nonce + sentAt headers per request.
 *
 * SECURITY (ADR-0022 red line):
 *  - No payload ever carries credentials. The coordinator would 400 anyway;
 *    this agent additionally scrubs credential-shaped fields client-side so
 *    a careless executor cannot leak them onto the wire at all.
 *  - The private key lives in process memory only (as a KeyObject); it is
 *    never serialized into any payload, header, or log.
 *
 * Task EXECUTION is injected: production wiring passes a closure over the
 * local CLI adapters (LocalCliRunner / ClaudeCodeAdapter); tests inject a
 * fake. The agent itself never spawns anything.
 */
import { createPublicKey, randomUUID, type KeyObject } from 'node:crypto'
import type { Task } from '@aedev/core'
import { privateKeyFromRawHex, rawPublicKeyHex, signFleetMessage } from '@aedev/core'

/** Same red-line shape the coordinator enforces (daemon fleet/auth.ts). */
const CREDENTIAL_FIELD_RE = /token|api[_-]?key|secret/i

/**
 * Deep-clone `value` with every credential-shaped object key dropped.
 * Client-side belt to the server-side braces: nothing credential-shaped
 * ever reaches the wire, even from a careless executor.
 */
export function scrubCredentialFields<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => scrubCredentialFields(v)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_FIELD_RE.test(k)) continue
    out[k] = scrubCredentialFields(v)
  }
  return out as T
}

export interface FleetExecutorResult {
  exitCode: number
  /** Evidence artifacts by name (e.g. { 'test-summary.md': '...' }). */
  evidence: Record<string, string>
  /** Gate verdicts for the /fleet/evidence self-report (reference only). */
  gates?: Record<string, boolean>
}

export type FleetExecutor = (task: Task) => Promise<FleetExecutorResult>

export interface FleetWorkerClock { now(): number }

/** Minimal fetch shape so tests can drive a fastify inject() instead of TCP. */
export interface FleetFetchResponse { status: number; json(): Promise<unknown> }
export type FleetFetchFn = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<FleetFetchResponse>

export interface FleetWorkerAgentOptions {
  baseUrl: string
  workerId: string
  operatorId: string
  privateKeyHex: string
  publicKeyHex: string
  executor: FleetExecutor
  clock?: FleetWorkerClock
  fetchFn?: FleetFetchFn
}

export interface FleetRegisterResult { ok: boolean; httpStatus: number; code?: string }

export type FleetRunOnceResult =
  | { status: 'idle' }
  | { status: 'completed'; taskId: string; exitCode: number; reportErrors: string[] }
  /** Coordinator said no (e.g. 403 worker_frozen, 429 budget_exceeded). */
  | { status: 'refused'; httpStatus: number; code: string }

export type FleetLoopResult = FleetRunOnceResult | { status: 'error'; message: string }

export interface FleetRunLoopOptions {
  intervalMs: number
  /** Resolving this promise interrupts the sleep and ends the loop. */
  stopSignal: Promise<void>
  /** Observer for each iteration — refusals/errors surface here, never throw. */
  onResult?: (result: FleetLoopResult) => void
}

const defaultFetch: FleetFetchFn = async (url, init) => {
  const res = await fetch(url, init)
  return { status: res.status, json: () => res.json() as Promise<unknown> }
}

function errorCode(body: unknown): string {
  const code = (body as { error?: unknown } | undefined)?.error
  return typeof code === 'string' && code.length > 0 ? code : 'unknown_error'
}

export class FleetWorkerAgent {
  private readonly baseUrl: string
  private readonly workerId: string
  private readonly operatorId: string
  private readonly publicKeyHex: string
  /** In-memory only — never serialized, never sent. */
  private readonly privateKey: KeyObject
  private readonly executor: FleetExecutor
  private readonly clock: FleetWorkerClock
  private readonly fetchFn: FleetFetchFn

  constructor(opts: FleetWorkerAgentOptions) {
    this.baseUrl = opts.baseUrl
    this.workerId = opts.workerId
    this.operatorId = opts.operatorId
    this.publicKeyHex = opts.publicKeyHex.toLowerCase()
    this.privateKey = privateKeyFromRawHex(opts.privateKeyHex)
    // Refuse a split identity up front: registering a public key this agent
    // cannot sign for would brick the worker after registration.
    const derived = rawPublicKeyHex(createPublicKey(this.privateKey))
    if (derived !== this.publicKeyHex) {
      throw new Error('publicKeyHex does not match the key derived from privateKeyHex')
    }
    this.executor = opts.executor
    this.clock = opts.clock ?? { now: () => Date.now() }
    this.fetchFn = opts.fetchFn ?? defaultFetch
  }

  /** The only unsigned call: bind workerId/operatorId to the public key. */
  async register(): Promise<FleetRegisterResult> {
    const body = { workerId: this.workerId, operatorId: this.operatorId, publicKey: this.publicKeyHex }
    const res = await this.fetchFn(this.url('/fleet/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 200) return { ok: true, httpStatus: 200 }
    return { ok: false, httpStatus: res.status, code: errorCode(await res.json().catch(() => undefined)) }
  }

  /** One claim → execute → self-report → lifecycle events → heartbeat pass. */
  async runOnce(): Promise<FleetRunOnceResult> {
    const claim = await this.signedPost('/fleet/claim', {})
    if (claim.status !== 200) {
      return { status: 'refused', httpStatus: claim.status, code: errorCode(claim.body) }
    }
    const task = (claim.body as { task?: Task | null } | undefined)?.task ?? null
    if (!task) return { status: 'idle' }

    const startedAt = new Date(this.clock.now()).toISOString()
    let result: FleetExecutorResult
    try {
      result = await this.executor(task)
    } catch (e) {
      result = { exitCode: 1, evidence: { 'executor-error.md': (e as Error).message } }
    }
    const finishedAt = new Date(this.clock.now()).toISOString()

    const reportErrors: string[] = []
    const evidence = await this.signedPost('/fleet/evidence', {
      taskId: task.id,
      selfReport: { gates: result.gates ?? {}, evidence: result.evidence, exitCode: result.exitCode },
    })
    if (evidence.status !== 200) reportErrors.push(`/fleet/evidence:${errorCode(evidence.body)}`)

    const events = await this.signedPost('/fleet/events', {
      events: [
        { type: 'worker.task_started', entityType: 'task', entityId: task.id, payload: { startedAt } },
        { type: 'worker.task_finished', entityType: 'task', entityId: task.id, payload: { finishedAt, exitCode: result.exitCode } },
      ],
    })
    if (events.status !== 200) reportErrors.push(`/fleet/events:${errorCode(events.body)}`)

    const heartbeat = await this.signedPost('/fleet/heartbeat', {})
    if (heartbeat.status !== 200) reportErrors.push(`/fleet/heartbeat:${errorCode(heartbeat.body)}`)

    return { status: 'completed', taskId: task.id, exitCode: result.exitCode, reportErrors }
  }

  /**
   * Poll forever until `stopSignal` resolves. Refusals (frozen worker,
   * budget hold) and transport errors are surfaced through `onResult` and
   * never crash the loop — the coordinator stays the source of truth on
   * whether this worker may work again later.
   */
  async runLoop(opts: FleetRunLoopOptions): Promise<void> {
    let stopped = false
    const stop = opts.stopSignal.then(() => { stopped = true })
    while (!stopped) {
      try {
        opts.onResult?.(await this.runOnce())
      } catch (e) {
        opts.onResult?.({ status: 'error', message: (e as Error).message })
      }
      if (stopped) break
      // Stop-signal interrupts the sleep (daemon watchdog pattern) so a
      // shutdown never waits out the polling interval.
      await Promise.race([new Promise<void>((r) => setTimeout(r, opts.intervalMs)), stop])
    }
  }

  private url(path: string): string {
    return new URL(path, this.baseUrl).toString()
  }

  private async signedPost(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    // Sign EXACTLY what goes on the wire — after the credential scrub.
    const payload = scrubCredentialFields(body)
    const nonce = randomUUID()
    const sentAt = new Date(this.clock.now()).toISOString()
    const res = await this.fetchFn(this.url(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-id': this.workerId,
        'x-nonce': nonce,
        'x-sent-at': sentAt,
        'x-signature': signFleetMessage(this.privateKey, payload, nonce, sentAt),
      },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: await res.json().catch(() => undefined) }
  }
}
