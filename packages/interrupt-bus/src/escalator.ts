import type { InterruptService } from './service.js'
import type { HoldRepository, HoldRecord } from './repository.js'
import { policyFor } from './policy.js'

export interface EscalatorOpts {
  service: InterruptService
  repo: HoldRepository
  now?: () => Date
  /** Maximum retry-3 attempts before dropping. */
  maxRetries?: number
}

/**
 * Escalator — periodic sweep that applies hold policy on-timeout actions.
 *
 * Stage C ships the logic; Stage I's chaos scheduler will be the one to
 * actually run sweep() on a cadence.
 */
export class Escalator {
  private readonly service: InterruptService
  private readonly repo: HoldRepository
  private readonly now: () => Date
  private readonly maxRetries: number

  constructor(opts: EscalatorOpts) {
    this.service = opts.service
    this.repo = opts.repo
    this.now = opts.now ?? (() => new Date())
    this.maxRetries = opts.maxRetries ?? 3
  }

  /** One sweep. Returns the number of actions taken. */
  async sweep(): Promise<number> {
    const open = await this.repo.openHolds()
    let actions = 0
    const nowMs = this.now().getTime()
    for (const h of open) {
      const policy = policyFor(h.reason)
      if (policy.ttlMs === Infinity) continue
      const ageMs = nowMs - new Date(h.openedAt).getTime()
      if (ageMs < policy.ttlMs) continue
      actions += await this.act(h)
    }
    return actions
  }

  private async act(h: HoldRecord): Promise<number> {
    const policy = policyFor(h.reason)
    switch (policy.onTimeout) {
      case 'retry-3':
        if (h.retries < this.maxRetries) {
          await this.service.retry({ taskId: h.taskId, holdId: h.id })
          return 1
        }
        await this.service.drop({ taskId: h.taskId, holdId: h.id, reason: 'retry-exhausted' })
        return 1
      case 'drop':
        await this.service.drop({ taskId: h.taskId, holdId: h.id, reason: 'ttl-expired' })
        return 1
      case 'escalate':
        await this.service.escalate({ taskId: h.taskId, holdId: h.id })
        return 1
      case 'halt':
        // Halt-class reasons never auto-act; they need operator decision.
        return 0
    }
  }
}
