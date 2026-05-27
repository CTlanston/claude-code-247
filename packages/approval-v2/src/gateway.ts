import type { EventLog } from '@aedev/event-log'
import { TokenSigner, TokenVerifier } from './token.js'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalTransport,
} from './transports.js'

export interface ApprovalGatewayOpts {
  log: EventLog
  signer: TokenSigner
  verifier: TokenVerifier
  primary: ApprovalTransport
  fallback: ApprovalTransport
  /** TTL for issued tokens; default 5 min per spike doc. */
  tokenTtlMs?: number
  /** Wakeup window before falling back; default 90s per spike. */
  failoverAfterMs?: number
  actor?: string
  now?: () => Date
}

export interface RequestApprovalArgs {
  taskId: string
  reason: string
  detail?: Record<string, unknown>
  /** Operator identity bound into the token (e.g., tailnet user). */
  operator: string
}

/**
 * ApprovalGateway — Stage D dual-rail orchestrator.
 *
 * Per spike (docs/spikes/dispatch-approval.md):
 *  - Primary = Tailscale (lower p50).
 *  - Fallback = Dispatch (wake-up rail).
 *  - If the primary health probe fails or the operator hasn't responded
 *    within failoverAfterMs, fire on Dispatch and accept whichever rail
 *    arrives first.
 *
 * Every approval emits:
 *  - approval.request.emitted   (with both pre-signed tokens in payload)
 *  - approval.transport.failover  (only if we flipped to fallback)
 *  - approval.decision.received (carries decision + via field)
 */
export class ApprovalGateway {
  private readonly log: EventLog
  private readonly signer: TokenSigner
  private readonly verifier: TokenVerifier
  private readonly primary: ApprovalTransport
  private readonly fallback: ApprovalTransport
  private readonly tokenTtlMs: number
  private readonly failoverAfterMs: number
  private readonly actor: string
  private readonly now: () => Date
  private readonly seenNonces = new Set<string>()

  constructor(opts: ApprovalGatewayOpts) {
    this.log = opts.log
    this.signer = opts.signer
    this.verifier = opts.verifier
    this.primary = opts.primary
    this.fallback = opts.fallback
    this.tokenTtlMs = opts.tokenTtlMs ?? 5 * 60 * 1000
    this.failoverAfterMs = opts.failoverAfterMs ?? 90 * 1000
    this.actor = opts.actor ?? 'daemon.approval-gateway'
    this.now = opts.now ?? (() => new Date())
  }

  async request(args: RequestApprovalArgs): Promise<{ approvalId: string; decision: ApprovalDecision; via: 'tailscale' | 'dispatch' }> {
    const approvalId = `appr_${this.now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const ts = this.now().toISOString()
    const approveTok = this.signer.sign({
      approvalId, taskId: args.taskId, actor: args.operator,
      decision: 'approve', ttlMs: this.tokenTtlMs, now: this.now().getTime(),
    })
    const rejectTok = this.signer.sign({
      approvalId, taskId: args.taskId, actor: args.operator,
      decision: 'reject', ttlMs: this.tokenTtlMs, now: this.now().getTime(),
    })

    await this.log.append({
      task_id: args.taskId,
      ts,
      actor: this.actor,
      kind: 'approval.request.emitted',
      payload: {
        approvalId, reason: args.reason, operator: args.operator,
        approveToken: approveTok.encoded, rejectToken: rejectTok.encoded,
      },
      idempotency_source: `${args.taskId}|approval|${approvalId}`,
    })

    const req: ApprovalRequest = {
      approvalId, taskId: args.taskId, reason: args.reason, detail: args.detail,
      approveToken: approveTok.encoded, rejectToken: rejectTok.encoded,
    }

    // Try primary first; if unhealthy or it throws, immediately fall back.
    let resp: ApprovalResponse
    const primaryHealthy = await this.primary.healthy()
    if (primaryHealthy) {
      try {
        resp = await this.primary.send(req, { timeoutMs: this.failoverAfterMs })
      } catch {
        await this.emitFailover(args.taskId, ts, approvalId, 'primary_threw')
        resp = await this.fallback.send(req)
      }
    } else {
      await this.emitFailover(args.taskId, ts, approvalId, 'primary_unhealthy')
      resp = await this.fallback.send(req)
    }

    const verified = this.verifier.verify(resp.token, {
      expectedApprovalId: approvalId,
      expectedTaskId: args.taskId,
      now: this.now().getTime(),
      seenNonces: this.seenNonces,
    })
    if (!verified.ok) {
      throw new Error(`approval token failed verification: ${verified.error}`)
    }
    const decision = verified.claims!.decision
    await this.log.append({
      task_id: args.taskId,
      ts: resp.receivedAt,
      actor: 'operator:' + args.operator,
      kind: 'approval.decision.received',
      payload: { approvalId, decision, via: resp.via },
      idempotency_source: `${approvalId}|decision|${verified.claims!.nonce}`,
    })
    return { approvalId, decision, via: resp.via }
  }

  private async emitFailover(taskId: string, ts: string, approvalId: string, reason: string): Promise<void> {
    await this.log.append({
      task_id: taskId,
      ts,
      actor: this.actor,
      kind: 'approval.transport.failover',
      payload: { approvalId, reason, from: 'tailscale', to: 'dispatch' },
      idempotency_source: `${approvalId}|failover`,
    })
  }
}
