import { createHash } from 'crypto'

/**
 * Premium debugger orchestration for Phase 9.
 *
 * Pattern (per the migration plan):
 *   1. The task runner attempts the same repair N times via the normal
 *      Coder loop.  N defaults to 3.
 *   2. After the threshold is hit, `PremiumDebugger.shouldEscalate()`
 *      returns true and the daemon calls `debug()`.
 *   3. `debug()` invokes a premium model (injectable, so tests use a
 *      stub) and returns a diagnosis + proposed patch plan.
 *   4. Circuit breakers stop the loop when retries can no longer make
 *      progress: same failure signature 3 times in a row, two attempts
 *      with no diff, missing credentials, or operator-requested halt.
 *
 * The signature is a stable hash of the error text and (optionally) the
 * stack location — two repair attempts that fail "the same way" have the
 * same signature even if timestamps differ.
 */
export interface RepairAttempt {
  /** Sequence number, 1-indexed. */
  attempt: number
  /** Stable signature for the failure (hash of error + location). */
  signature: string
  /** Optional diff that the attempt produced.  Empty/missing → "no diff". */
  diff?: string
  /** Optional model output for analysis. */
  notes?: string
}

export interface PremiumDebugContext {
  /** Stable id of the task being repaired. */
  taskId: string
  /** All repair attempts so far (chronological). */
  history: RepairAttempt[]
  /** Evidence bundle from the most recent failed attempt. */
  bundle: Record<string, string>
  /** Optional risk score so the debugger can de-prioritise low-risk tasks. */
  riskScore?: number
}

export interface PremiumDebugInput {
  taskId: string
  failureSignature: string
  recentDiff: string
  bundle: Record<string, string>
}

export interface PremiumDebugResponse {
  diagnosis: string
  patchPlan: string
  shouldRetry: boolean
}

export type PremiumDebuggerFn = (input: PremiumDebugInput) => Promise<PremiumDebugResponse>

export interface PremiumDebuggerOptions {
  /** Number of normal repair attempts before premium is invoked.  Default 3. */
  normalAttemptThreshold?: number
  /** Maximum same-signature failures before the circuit trips.  Default 3. */
  maxSameSignatureFailures?: number
  /** Maximum no-diff attempts before the circuit trips.  Default 2. */
  maxNoDiffAttempts?: number
  /** Optional credentials check.  If false, the circuit trips before any premium call. */
  hasCredentials?: () => boolean
  /** Injectable premium model.  Real implementation calls Anthropic/OpenAI premium tier. */
  debuggerFn?: PremiumDebuggerFn
  /** Forbidden path detection.  Used by the safety circuit breaker. */
  isForbiddenPath?: (path: string) => boolean
}

export interface CircuitBreakerResult {
  open: boolean
  reason?: string
}

export interface PremiumDebugResult {
  invokedPremium: boolean
  response?: PremiumDebugResponse
  circuitBreaker: CircuitBreakerResult
  /** Human-readable summary written to the evidence bundle as `premium-debugger.md`. */
  report: string
}

const DEFAULTS = {
  normalAttemptThreshold: 3,
  maxSameSignatureFailures: 3,
  maxNoDiffAttempts: 2,
}

export class PremiumDebugger {
  private readonly opts: Required<Pick<PremiumDebuggerOptions, 'normalAttemptThreshold' | 'maxSameSignatureFailures' | 'maxNoDiffAttempts'>> &
    Pick<PremiumDebuggerOptions, 'hasCredentials' | 'debuggerFn' | 'isForbiddenPath'>

  constructor(opts: PremiumDebuggerOptions = {}) {
    this.opts = {
      normalAttemptThreshold: opts.normalAttemptThreshold ?? DEFAULTS.normalAttemptThreshold,
      maxSameSignatureFailures: opts.maxSameSignatureFailures ?? DEFAULTS.maxSameSignatureFailures,
      maxNoDiffAttempts: opts.maxNoDiffAttempts ?? DEFAULTS.maxNoDiffAttempts,
      ...(opts.hasCredentials !== undefined ? { hasCredentials: opts.hasCredentials } : {}),
      ...(opts.debuggerFn !== undefined ? { debuggerFn: opts.debuggerFn } : {}),
      ...(opts.isForbiddenPath !== undefined ? { isForbiddenPath: opts.isForbiddenPath } : {}),
    }
  }

  /** True iff the task has hit the normal-attempt threshold and premium should be tried. */
  shouldEscalate(history: RepairAttempt[]): boolean {
    return history.length >= this.opts.normalAttemptThreshold
  }

  /**
   * Inspect history for "we're going in circles" signals.  Returns
   * { open: true, reason } when the loop must halt.  Order: credentials →
   * same-signature streak → no-diff streak → forbidden-path requested.
   */
  circuitBreaker(history: RepairAttempt[], wantsPath?: string): CircuitBreakerResult {
    if (this.opts.hasCredentials && !this.opts.hasCredentials()) {
      return { open: true, reason: 'Premium debugger credentials are not available.' }
    }
    if (this.opts.isForbiddenPath && wantsPath && this.opts.isForbiddenPath(wantsPath)) {
      return { open: true, reason: `Premium debugger requested forbidden path: ${wantsPath}` }
    }
    const sameSigStreak = trailingStreak(history, (a, b) => a.signature === b.signature)
    if (sameSigStreak >= this.opts.maxSameSignatureFailures) {
      return {
        open: true,
        reason: `Same failure signature repeated ${sameSigStreak} times — no progress.`,
      }
    }
    const noDiffStreak = trailingStreak(history, (a, b) => isEmptyDiff(a.diff) && isEmptyDiff(b.diff))
    // trailingStreak counts back from the last element; we need the LAST element to also be empty
    // for the streak to be meaningful.
    if (
      history.length >= this.opts.maxNoDiffAttempts &&
      isEmptyDiff(history[history.length - 1]?.diff) &&
      noDiffStreak >= this.opts.maxNoDiffAttempts
    ) {
      return {
        open: true,
        reason: `${noDiffStreak} consecutive attempts produced no diff — premium debugger cannot help.`,
      }
    }
    return { open: false }
  }

  async debug(ctx: PremiumDebugContext): Promise<PremiumDebugResult> {
    const breaker = this.circuitBreaker(ctx.history)
    if (breaker.open) {
      return {
        invokedPremium: false,
        circuitBreaker: breaker,
        report: this.renderReport({ ctx, breaker, response: undefined }),
      }
    }

    if (!this.opts.debuggerFn) {
      return {
        invokedPremium: false,
        circuitBreaker: { open: true, reason: 'No premium debuggerFn injected — cannot invoke premium model.' },
        report: this.renderReport({ ctx, breaker: { open: true, reason: 'no debuggerFn' }, response: undefined }),
      }
    }

    const recent = ctx.history[ctx.history.length - 1]
    const recentDiff = recent?.diff ?? ''
    const signature = recent?.signature ?? 'unknown'
    const response = await this.opts.debuggerFn({
      taskId: ctx.taskId,
      failureSignature: signature,
      recentDiff,
      bundle: ctx.bundle,
    })

    return {
      invokedPremium: true,
      response,
      circuitBreaker: { open: false },
      report: this.renderReport({ ctx, breaker: { open: false }, response }),
    }
  }

  private renderReport({
    ctx,
    breaker,
    response,
  }: {
    ctx: PremiumDebugContext
    breaker: CircuitBreakerResult
    response: PremiumDebugResponse | undefined
  }): string {
    const lines: string[] = [
      `# Premium Debugger — ${ctx.taskId}`,
      '',
      `**Attempts so far:** ${ctx.history.length}`,
      `**Threshold:** ${this.opts.normalAttemptThreshold}`,
      `**Generated:** ${new Date().toISOString()}`,
      '',
      '## History',
    ]
    if (ctx.history.length === 0) {
      lines.push('- (no recorded attempts)')
    } else {
      for (const a of ctx.history) {
        lines.push(`- attempt ${a.attempt} — signature ${a.signature} — ${isEmptyDiff(a.diff) ? 'no diff' : 'diff present'}${a.notes ? ` — ${a.notes}` : ''}`)
      }
    }
    lines.push('')
    lines.push('## Circuit breaker')
    lines.push(`- open: ${breaker.open ? 'YES' : 'no'}`)
    if (breaker.reason) lines.push(`- reason: ${breaker.reason}`)
    lines.push('')
    if (response) {
      lines.push('## Premium model response')
      lines.push(`- shouldRetry: ${response.shouldRetry}`)
      lines.push(`- diagnosis: ${response.diagnosis}`)
      lines.push(`- patch plan:`)
      lines.push('```')
      lines.push(response.patchPlan)
      lines.push('```')
    } else {
      lines.push('## Premium model response')
      lines.push('- (not invoked)')
    }
    return lines.join('\n') + '\n'
  }
}

/**
 * Build a stable signature for a failed attempt from its error text and
 * (optionally) a file:line tag.  Whitespace + line numbers + addresses are
 * normalized so equivalent failures hash equal.
 */
export function buildFailureSignature(input: { errorText?: string; location?: string }): string {
  const error = (input.errorText ?? '').replace(/\s+/g, ' ').trim()
  const location = (input.location ?? '').trim()
  const normalized = `${error}|${location}`
    .replace(/\b\d+\b/g, 'N')         // line numbers
    .replace(/0x[0-9a-f]+/gi, 'HEX')  // addresses
    .toLowerCase()
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function isEmptyDiff(diff: string | undefined): boolean {
  if (!diff) return true
  return diff.replace(/\s+/g, '').length === 0
}

function trailingStreak(history: RepairAttempt[], pred: (a: RepairAttempt, b: RepairAttempt) => boolean): number {
  if (history.length === 0) return 0
  let streak = 1
  for (let i = history.length - 1; i > 0; i--) {
    const a = history[i]
    const b = history[i - 1]
    if (a && b && pred(a, b)) streak++
    else break
  }
  return streak
}
