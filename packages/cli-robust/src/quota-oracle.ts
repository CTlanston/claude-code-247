/** Stage M1 — Quota Oracle (±5% accuracy).
 *
 * Workbook §3 Stage M1 L1: "quota oracle ±5%". The subscription CLI
 * does not expose its billing surface to us directly; we estimate by:
 *
 *   1. Maintaining a per-call counter (already in QuotaTracker).
 *   2. Optionally sampling a real billing surface (file the CLI writes
 *      a usage stat to; pluggable for tests).
 *   3. Computing the residual (estimate - billing) / billing.
 *
 * When the residual exceeds the configured tolerance (default ±5%),
 * the oracle emits `cli.quota.oracle.drift` and the daemon escalates.
 */

export interface BillingSurfaceSnapshot {
  /** Calls the real billing source reports for the current bucket. */
  callsBilled: number
  /** When the billing snapshot was taken. */
  ts: string
}

export interface BillingSurface {
  /** Read the current bucket's billed-call count. Production binding
   *  parses a CLI-managed JSON file or an HTTP endpoint; tests inject
   *  a deterministic mock. */
  snapshot(): Promise<BillingSurfaceSnapshot>
}

export interface QuotaOracleOpts {
  /** ±tolerance fraction. Default 0.05 (workbook target). */
  tolerance?: number
}

export interface QuotaOracleVerdict {
  estimateCalls: number
  billedCalls: number
  residualFraction: number
  withinTolerance: boolean
  tolerance: number
}

export class QuotaOracle {
  private callsEstimate = 0
  private readonly tol: number

  constructor(opts: QuotaOracleOpts = {}) {
    this.tol = opts.tolerance ?? 0.05
  }

  /** Bump our local estimate on every CLI invocation. */
  record(): void {
    this.callsEstimate++
  }

  estimate(): number {
    return this.callsEstimate
  }

  resetBucket(): void {
    this.callsEstimate = 0
  }

  /** Compare our estimate against the real billing surface. */
  async compare(billing: BillingSurface): Promise<QuotaOracleVerdict> {
    const snap = await billing.snapshot()
    // Guard divide-by-zero: when billedCalls is 0 we treat any non-zero
    // estimate as full drift (1.0).
    const residual = snap.callsBilled === 0
      ? (this.callsEstimate === 0 ? 0 : 1)
      : Math.abs(this.callsEstimate - snap.callsBilled) / snap.callsBilled
    return {
      estimateCalls: this.callsEstimate,
      billedCalls: snap.callsBilled,
      residualFraction: residual,
      withinTolerance: residual <= this.tol,
      tolerance: this.tol,
    }
  }
}

/** Static-snapshot billing source for tests. */
export class StaticBillingSurface implements BillingSurface {
  constructor(private readonly callsBilled: number) {}
  async snapshot(): Promise<BillingSurfaceSnapshot> {
    return { callsBilled: this.callsBilled, ts: new Date().toISOString() }
  }
}
