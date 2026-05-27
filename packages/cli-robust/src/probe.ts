import type { EventLog } from '@aedev/event-log'
import type { ProbeFn, ProbeResult } from './types.js'

export interface SessionProbeOpts {
  log: EventLog
  taskId: string
  probe: ProbeFn
  /** Worker actor string for event provenance. */
  actor?: string
  /** Wall-clock that the probe driver passes in (so tests can fake it). */
  now?: () => Date
  /** How long a CLI is allowed to be observed expired before we open a HOLD.
   *  Default per workbook §3 Stage B: 15 min. */
  expirationGraceMs?: number
}

/**
 * SessionProbe — Stage B.1 prototype.
 *
 * Holds no state of its own; on every `tick()` it calls the user-supplied
 * probe function, emits one `cli.session.probed` event recording the result,
 * and if the CLI has been observed expired for at least `expirationGraceMs`,
 * emits a `cli.session.expired` event AND a `hold.created` event with
 * reason `session_expired`.
 *
 * The probe function itself is injected — Stage M1 plugs in a real keychain
 * + `claude --print` smoke; Stage B tests use a fake to verify the wiring.
 *
 * Hold events here are a thin proxy; the real HoldService comes in Stage C
 * and will subscribe to `hold.created` to apply policy `{ttl, on_timeout}`.
 */
export class SessionProbe {
  private readonly log: EventLog
  private readonly taskId: string
  private readonly probe: ProbeFn
  private readonly actor: string
  private readonly now: () => Date
  private readonly graceMs: number
  private firstExpiredAt: number | null = null
  /** id of the most recent .expired event so the hold can causate back to it. */
  private lastExpiredCausation: string | null = null

  constructor(opts: SessionProbeOpts) {
    this.log = opts.log
    this.taskId = opts.taskId
    this.probe = opts.probe
    this.actor = opts.actor ?? 'worker.session-probe'
    this.now = opts.now ?? (() => new Date())
    this.graceMs = opts.expirationGraceMs ?? 15 * 60 * 1000
  }

  /** One probe tick — returns the probe result so callers can react. */
  async tick(): Promise<ProbeResult> {
    const result = await this.probe()
    const ts = this.now().toISOString()
    // No explicit idempotency_source: each tick is a fresh observation, and
    // the appender's default key (ULID-suffixed) is unique by construction.
    const probedId = await this.log.append({
      task_id: this.taskId,
      ts,
      actor: this.actor,
      kind: 'cli.session.probed',
      payload: { ok: result.ok, detail: result.detail ?? {} },
    })

    if (result.ok) {
      this.firstExpiredAt = null
      this.lastExpiredCausation = null
      return result
    }

    const expiredId = await this.log.append({
      task_id: this.taskId,
      ts,
      actor: this.actor,
      kind: 'cli.session.expired',
      payload: { detail: result.detail ?? {} },
      causation_id: probedId,
    })
    this.lastExpiredCausation = expiredId

    const nowMs = this.now().getTime()
    if (this.firstExpiredAt === null) this.firstExpiredAt = nowMs

    if (nowMs - this.firstExpiredAt >= this.graceMs) {
      // hold.policy.created — three-segment kind per §4.4. The
      // idempotency_source is anchored on firstExpiredAt so repeated ticks
      // during the same expiration window do not re-open the hold; a
      // successful probe clears the anchor, allowing a future hold to fire.
      await this.log.append({
        task_id: this.taskId,
        ts,
        actor: this.actor,
        kind: 'hold.policy.created',
        payload: {
          reason: 'session_expired',
          opened_after_ms: nowMs - this.firstExpiredAt,
        },
        causation_id: expiredId,
        idempotency_source: `${this.taskId}|hold.policy.created|session_expired|${this.firstExpiredAt}`,
      })
    }

    return result
  }
}
