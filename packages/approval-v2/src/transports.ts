export type ApprovalDecision = 'approve' | 'reject'

export interface ApprovalRequest {
  approvalId: string
  taskId: string
  reason: string
  detail?: Record<string, unknown>
  /** Pre-signed token the operator returns with their decision. */
  approveToken: string
  rejectToken: string
}

export interface ApprovalResponse {
  approvalId: string
  decision: ApprovalDecision
  /** Returned token (matches one of approveToken / rejectToken). */
  token: string
  receivedAt: string
  via: 'tailscale' | 'dispatch'
}

export interface ApprovalTransport {
  name: 'tailscale' | 'dispatch'
  /** Send request to the operator. Resolves when they decide (or rejects on transport error). */
  send(req: ApprovalRequest, opts?: { timeoutMs?: number }): Promise<ApprovalResponse>
  /** Health probe; gateway uses this to decide failover. */
  healthy(): Promise<boolean>
}

/**
 * In-memory Tailscale transport. The real one posts to an HTMX page on the
 * Tailscale tailnet. For tests + Stage D L1 we hand it a "responder" that
 * synthesizes the operator's decision.
 */
export class TailscaleTransport implements ApprovalTransport {
  readonly name = 'tailscale' as const
  private healthState = true
  constructor(
    private readonly responder: (
      req: ApprovalRequest,
    ) => Promise<{ decision: ApprovalDecision; token: string }> | { decision: ApprovalDecision; token: string },
  ) {}
  setHealth(h: boolean): void {
    this.healthState = h
  }
  async healthy(): Promise<boolean> {
    return this.healthState
  }
  async send(req: ApprovalRequest): Promise<ApprovalResponse> {
    if (!this.healthState) throw new Error('tailscale transport unhealthy')
    const r = await this.responder(req)
    return {
      approvalId: req.approvalId,
      decision: r.decision,
      token: r.token,
      receivedAt: new Date().toISOString(),
      via: 'tailscale',
    }
  }
}

/** Dispatch (CF Worker + ntfy) transport, similarly stubbed. */
export class DispatchTransport implements ApprovalTransport {
  readonly name = 'dispatch' as const
  private healthState = true
  constructor(
    private readonly responder: (
      req: ApprovalRequest,
    ) => Promise<{ decision: ApprovalDecision; token: string }> | { decision: ApprovalDecision; token: string },
  ) {}
  setHealth(h: boolean): void {
    this.healthState = h
  }
  async healthy(): Promise<boolean> {
    return this.healthState
  }
  async send(req: ApprovalRequest): Promise<ApprovalResponse> {
    if (!this.healthState) throw new Error('dispatch transport unhealthy')
    const r = await this.responder(req)
    return {
      approvalId: req.approvalId,
      decision: r.decision,
      token: r.token,
      receivedAt: new Date().toISOString(),
      via: 'dispatch',
    }
  }
}
