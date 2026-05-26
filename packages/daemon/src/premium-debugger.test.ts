import { describe, it, expect } from 'vitest'
import {
  PremiumDebugger,
  buildFailureSignature,
  type PremiumDebuggerFn,
  type RepairAttempt,
} from './premium-debugger.js'

function attempt(n: number, opts: Partial<RepairAttempt> = {}): RepairAttempt {
  return {
    attempt: n,
    signature: opts.signature ?? `sig-${n}`,
    diff: opts.diff ?? '-- a\n+ b\n',
    notes: opts.notes,
  }
}

describe('buildFailureSignature', () => {
  it('produces identical signatures for whitespace-only differences', () => {
    const a = buildFailureSignature({ errorText: 'TypeError: foo', location: 'src/a.ts:42' })
    const b = buildFailureSignature({ errorText: 'TypeError:   foo', location: 'src/a.ts:42' })
    expect(a).toBe(b)
  })

  it('normalizes line numbers so the same error at different lines hashes equal', () => {
    const a = buildFailureSignature({ errorText: 'TypeError: foo at line 12', location: 'src/a.ts:12' })
    const b = buildFailureSignature({ errorText: 'TypeError: foo at line 18', location: 'src/a.ts:18' })
    expect(a).toBe(b)
  })

  it('produces different signatures for genuinely different errors', () => {
    const a = buildFailureSignature({ errorText: 'TypeError: foo', location: 'src/a.ts' })
    const b = buildFailureSignature({ errorText: 'ReferenceError: bar', location: 'src/a.ts' })
    expect(a).not.toBe(b)
  })
})

describe('PremiumDebugger — shouldEscalate', () => {
  it('returns false until the threshold is hit', () => {
    const pd = new PremiumDebugger({ normalAttemptThreshold: 3 })
    expect(pd.shouldEscalate([])).toBe(false)
    expect(pd.shouldEscalate([attempt(1)])).toBe(false)
    expect(pd.shouldEscalate([attempt(1), attempt(2)])).toBe(false)
  })

  it('returns true at and after the threshold', () => {
    const pd = new PremiumDebugger({ normalAttemptThreshold: 3 })
    expect(pd.shouldEscalate([attempt(1), attempt(2), attempt(3)])).toBe(true)
    expect(pd.shouldEscalate([attempt(1), attempt(2), attempt(3), attempt(4)])).toBe(true)
  })
})

describe('PremiumDebugger — circuit breaker', () => {
  it('trips when same signature repeats >= maxSameSignatureFailures times', () => {
    const pd = new PremiumDebugger({ maxSameSignatureFailures: 3 })
    const history = [
      attempt(1, { signature: 'X' }),
      attempt(2, { signature: 'X' }),
      attempt(3, { signature: 'X' }),
    ]
    const r = pd.circuitBreaker(history)
    expect(r.open).toBe(true)
    expect(r.reason).toContain('Same failure signature')
  })

  it('does NOT trip when signatures differ even if attempts are many', () => {
    const pd = new PremiumDebugger({ maxSameSignatureFailures: 3 })
    const history = [
      attempt(1, { signature: 'A' }),
      attempt(2, { signature: 'B' }),
      attempt(3, { signature: 'C' }),
      attempt(4, { signature: 'A' }),
    ]
    expect(pd.circuitBreaker(history).open).toBe(false)
  })

  it('trips on consecutive empty diffs >= maxNoDiffAttempts', () => {
    const pd = new PremiumDebugger({ maxNoDiffAttempts: 2 })
    const history = [
      attempt(1, { signature: 'A', diff: '-- a\n' }),
      attempt(2, { signature: 'B', diff: '' }),
      attempt(3, { signature: 'C', diff: '   ' }),
    ]
    const r = pd.circuitBreaker(history)
    expect(r.open).toBe(true)
    expect(r.reason).toContain('no diff')
  })

  it('trips when credentials are missing', () => {
    const pd = new PremiumDebugger({ hasCredentials: () => false })
    expect(pd.circuitBreaker([]).open).toBe(true)
    expect(pd.circuitBreaker([]).reason).toContain('credentials')
  })

  it('trips when premium debugger requests a forbidden path', () => {
    const pd = new PremiumDebugger({ isForbiddenPath: (p: string) => p.startsWith('.env') })
    const r = pd.circuitBreaker([], '.env.production')
    expect(r.open).toBe(true)
    expect(r.reason).toContain('forbidden path')
  })

  it('does NOT trip on a healthy mixed history', () => {
    const pd = new PremiumDebugger()
    const history = [
      attempt(1, { signature: 'A', diff: '-- a\n' }),
      attempt(2, { signature: 'B', diff: '-- b\n' }),
    ]
    expect(pd.circuitBreaker(history).open).toBe(false)
  })
})

describe('PremiumDebugger — debug invocation', () => {
  it('does not invoke premium when the circuit breaker is open', async () => {
    const debuggerFn: PremiumDebuggerFn = async () => ({ diagnosis: 'd', patchPlan: 'p', shouldRetry: true })
    const pd = new PremiumDebugger({
      maxSameSignatureFailures: 2,
      debuggerFn,
    })
    const history = [
      attempt(1, { signature: 'X' }),
      attempt(2, { signature: 'X' }),
    ]
    const result = await pd.debug({ taskId: 't', history, bundle: {} })
    expect(result.invokedPremium).toBe(false)
    expect(result.circuitBreaker.open).toBe(true)
    expect(result.report).toContain('Circuit breaker')
  })

  it('invokes premium when history is healthy and returns the model response', async () => {
    let called = false
    const debuggerFn: PremiumDebuggerFn = async (input) => {
      called = true
      expect(input.taskId).toBe('t-1')
      expect(input.failureSignature).toBe('A')
      return { diagnosis: 'looks fine', patchPlan: 'apply X', shouldRetry: true }
    }
    const pd = new PremiumDebugger({ debuggerFn })
    const result = await pd.debug({
      taskId: 't-1',
      history: [attempt(1, { signature: 'A' }), attempt(2, { signature: 'B' }), attempt(3, { signature: 'A', diff: '-- z' })],
      bundle: { 'plan.md': '# Plan' },
    })
    expect(called).toBe(true)
    expect(result.invokedPremium).toBe(true)
    expect(result.response?.diagnosis).toBe('looks fine')
    expect(result.report).toContain('## Premium model response')
  })

  it('trips circuit and does NOT call premium when no debuggerFn is configured', async () => {
    const pd = new PremiumDebugger({})
    const result = await pd.debug({ taskId: 't', history: [attempt(1)], bundle: {} })
    expect(result.invokedPremium).toBe(false)
    expect(result.circuitBreaker.open).toBe(true)
    expect(result.circuitBreaker.reason).toContain('debuggerFn')
  })
})
