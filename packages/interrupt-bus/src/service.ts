import type { EventLog } from '@aedev/event-log'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { policyFor, type HoldReason } from './policy.js'

export interface InterruptServiceOpts {
  log: EventLog
  holdsMdPath?: string
  actor?: string
  now?: () => Date
}

export interface OpenHoldArgs {
  taskId: string
  reason: HoldReason
  detail?: Record<string, unknown>
  anchor?: string                // idempotency anchor; defaults to taskId|reason|<day>
  causationId?: string
}

export interface ResolveHoldArgs {
  taskId: string
  holdId: string                 // the hold.policy.created event id
  by?: string                    // operator / system
  reason?: string
}

/**
 * InterruptService — Stage C glue.
 *
 * Writes hold.policy.* events to the event log (single source of truth)
 * AND mirrors them to ~/.claude-code-247/logs/holds.md as a human-readable
 * tail. The markdown file is a view: deleting it is harmless, the next
 * sweep reducer rebuilds it.
 *
 * Notification (ntfy) is a side effect handled by ApprovalGateway in
 * Stage D; this service just emits the event the gateway listens for.
 */
export class InterruptService {
  private readonly log: EventLog
  private readonly holdsMdPath: string | null
  private readonly actor: string
  private readonly now: () => Date

  constructor(opts: InterruptServiceOpts) {
    this.log = opts.log
    this.holdsMdPath = opts.holdsMdPath ?? null
    this.actor = opts.actor ?? 'daemon.interrupt-bus'
    this.now = opts.now ?? (() => new Date())
  }

  async open(args: OpenHoldArgs): Promise<string> {
    const policy = policyFor(args.reason)
    const ts = this.now().toISOString()
    const dayKey = ts.slice(0, 10)
    const anchor = args.anchor ?? `${args.taskId}|${args.reason}|${dayKey}`

    const id = await this.log.append({
      task_id: args.taskId,
      ts,
      actor: this.actor,
      kind: 'hold.policy.created',
      payload: {
        reason: args.reason,
        ttlMs: policy.ttlMs === Infinity ? null : policy.ttlMs,
        onTimeout: policy.onTimeout,
        detail: args.detail ?? {},
      },
      causation_id: args.causationId,
      idempotency_source: `${args.taskId}|hold.policy.created|${args.reason}|${anchor}`,
    })

    await this.appendHoldsMd(`- [${ts}] HOLD OPEN  ${args.reason}  task=${args.taskId}  id=${id}`)
    return id
  }

  async resolve(args: ResolveHoldArgs): Promise<void> {
    const ts = this.now().toISOString()
    await this.log.append({
      task_id: args.taskId,
      ts,
      actor: this.actor,
      kind: 'hold.policy.resolved',
      payload: { by: args.by ?? 'system', reason: args.reason ?? 'manual' },
      causation_id: args.holdId,
      idempotency_source: `${args.holdId}|resolved`,
    })
    await this.appendHoldsMd(`- [${ts}] HOLD RESOLVED  id=${args.holdId}  by=${args.by ?? 'system'}`)
  }

  async escalate(args: { taskId: string; holdId: string; to?: string }): Promise<void> {
    const ts = this.now().toISOString()
    await this.log.append({
      task_id: args.taskId,
      ts,
      actor: this.actor,
      kind: 'hold.policy.escalated',
      payload: { to: args.to ?? 'operator' },
      causation_id: args.holdId,
      idempotency_source: `${args.holdId}|escalated`,
    })
    await this.appendHoldsMd(`- [${ts}] HOLD ESCALATED id=${args.holdId} to=${args.to ?? 'operator'}`)
  }

  async drop(args: { taskId: string; holdId: string; reason?: string }): Promise<void> {
    const ts = this.now().toISOString()
    await this.log.append({
      task_id: args.taskId,
      ts,
      actor: this.actor,
      kind: 'hold.policy.dropped',
      payload: { reason: args.reason ?? 'ttl-expired' },
      causation_id: args.holdId,
      idempotency_source: `${args.holdId}|dropped`,
    })
    await this.appendHoldsMd(`- [${ts}] HOLD DROPPED   id=${args.holdId} reason=${args.reason ?? 'ttl-expired'}`)
  }

  async retry(args: { taskId: string; holdId: string }): Promise<void> {
    const ts = this.now().toISOString()
    await this.log.append({
      task_id: args.taskId,
      ts,
      actor: this.actor,
      kind: 'hold.policy.retried',
      payload: {},
      causation_id: args.holdId,
      // each retry must be its own event; no idempotency anchor.
    })
    await this.appendHoldsMd(`- [${ts}] HOLD RETRY     id=${args.holdId}`)
  }

  private async appendHoldsMd(line: string): Promise<void> {
    if (!this.holdsMdPath) return
    await fs.mkdir(path.dirname(this.holdsMdPath), { recursive: true })
    await fs.appendFile(this.holdsMdPath, line + '\n', 'utf8')
  }
}
