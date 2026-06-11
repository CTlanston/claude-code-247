/**
 * CloudHull c1–c4 — unit proof for the real-smoke PASS/FAIL policy.
 *
 * The container CI has no live claude/codex/gemini sessions, so the smoke's
 * semantics are proven HERE on the extracted pure module; the script
 * (scripts/operator-cockpit-real-smoke.ts) is a thin shell over these
 * functions.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCEPT_PLANNER_FALLBACK_ENV,
  EMPTY_PROVIDER_OBSERVATION,
  REGRESSION_EVIDENCE_MISSING,
  REPO_NAME_ENV,
  SOURCE_REPO_ENV,
  buildProviderObservation,
  describeRepoSource,
  evaluateProviderPolicy,
  expectedPrBlockCode,
  finalResultLabel,
  parseRegressionEvidence,
  resolveRealSmokeMode,
  resolveSourceRepoChoice,
  resolveValidatorTerminal,
  validatorFailure,
  type ProviderObservation,
} from './real-smoke-policy.js'

const STRICT_OK: ProviderObservation = {
  plannerProviders: ['claude-cli'],
  plannerFallbackObserved: false,
  plannerAuthModes: ['local_claude_code'],
  workerProviders: ['codex-cli'],
  workerAuthModes: ['local_codex'],
}

const FALLBACK_PLANNED: ProviderObservation = {
  ...STRICT_OK,
  plannerProviders: ['codex-cli'],
  plannerFallbackObserved: true,
  plannerAuthModes: ['local_codex'],
}

describe('cycle 1 — resolveRealSmokeMode', () => {
  it('defaults to strict when the accept-fallback env is unset', () => {
    expect(resolveRealSmokeMode({})).toBe('strict')
  })

  it('AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK=1 → fallback-proof', () => {
    expect(resolveRealSmokeMode({ [ACCEPT_PLANNER_FALLBACK_ENV]: '1' })).toBe('fallback-proof')
    expect(resolveRealSmokeMode({ [ACCEPT_PLANNER_FALLBACK_ENV]: 'true' })).toBe('fallback-proof')
  })

  it('0 / random values stay strict', () => {
    expect(resolveRealSmokeMode({ [ACCEPT_PLANNER_FALLBACK_ENV]: '0' })).toBe('strict')
    expect(resolveRealSmokeMode({ [ACCEPT_PLANNER_FALLBACK_ENV]: 'codex' })).toBe('strict')
  })
})

describe('cycle 1 — evaluateProviderPolicy', () => {
  it('strict + claude planner + codex coder → PASS (strict)', () => {
    const v = evaluateProviderPolicy('strict', STRICT_OK)
    expect(v).toMatchObject({ requestedMode: 'strict', achievedMode: 'strict', resultLabel: 'PASS (strict)', failures: [] })
  })

  it('strict + planner fallback → FAIL with PLANNER_FALLBACK_NOT_ACCEPTED (clear reason)', () => {
    const v = evaluateProviderPolicy('strict', FALLBACK_PLANNED)
    expect(v.resultLabel).toBe('FAIL')
    expect(v.achievedMode).toBe('degraded')
    expect(v.failures.join('\n')).toContain('PLANNER_FALLBACK_NOT_ACCEPTED')
    expect(v.failures.join('\n')).toContain(ACCEPT_PLANNER_FALLBACK_ENV)
  })

  it('fallback-proof + planner fallback → DEGRADED (planner fallback), never a strict PASS', () => {
    const v = evaluateProviderPolicy('fallback-proof', FALLBACK_PLANNED)
    expect(v.failures).toEqual([])
    expect(v.achievedMode).toBe('degraded')
    expect(v.resultLabel).toBe('DEGRADED (planner fallback)')
    expect(v.resultLabel).not.toBe('PASS (strict)')
  })

  it('fallback-proof + clean claude planner → achieved strict PASS (records both modes)', () => {
    const v = evaluateProviderPolicy('fallback-proof', STRICT_OK)
    expect(v).toMatchObject({ requestedMode: 'fallback-proof', achievedMode: 'strict', resultLabel: 'PASS (strict)' })
  })

  it('coder requirement is identical in both modes: missing/wrong coder → FAIL', () => {
    const noCoder = { ...STRICT_OK, workerProviders: [], workerAuthModes: [] }
    expect(evaluateProviderPolicy('strict', noCoder).resultLabel).toBe('FAIL')
    expect(evaluateProviderPolicy('fallback-proof', { ...FALLBACK_PLANNED, workerProviders: ['mock'] }).resultLabel).toBe('FAIL')
  })

  it('claude observed as coder → FAIL (P1 split violated)', () => {
    const v = evaluateProviderPolicy('strict', { ...STRICT_OK, workerProviders: ['codex-cli', 'claude-cli'] })
    expect(v.failures.join('\n')).toContain('claude-cli was observed as coder')
  })

  it('non-local auth modes fail: planner not local_claude_code / coder not local_codex', () => {
    expect(evaluateProviderPolicy('strict', { ...STRICT_OK, plannerAuthModes: ['anthropic_api_fallback'] }).resultLabel).toBe('FAIL')
    expect(evaluateProviderPolicy('strict', { ...STRICT_OK, workerAuthModes: ['anthropic_api_fallback'] }).resultLabel).toBe('FAIL')
    // fallback-proof accepts local_codex planner auth on the fallback path, but never a paid API.
    expect(evaluateProviderPolicy('fallback-proof', { ...FALLBACK_PLANNED, plannerAuthModes: ['anthropic_api_fallback'] }).resultLabel).toBe('FAIL')
  })

  it('empty observation (planner hold / nothing ran) → FAIL in both modes', () => {
    expect(evaluateProviderPolicy('strict', EMPTY_PROVIDER_OBSERVATION).resultLabel).toBe('FAIL')
    expect(evaluateProviderPolicy('fallback-proof', EMPTY_PROVIDER_OBSERVATION).resultLabel).toBe('FAIL')
  })
})

describe('cycle 1 — buildProviderObservation', () => {
  const events = [
    { type: 'operator.role_done', entityType: 'operator_session', payload: { role: 'planner', provider: 'claude-cli', authMode: 'local_claude_code' } },
    { type: 'operator.cost_updated', entityType: 'operator_session', payload: { scope: 'planner_brainstorm', provider: 'claude-cli', authMode: 'local_claude_code' } },
    { type: 'operator.worker_started', entityType: 'mission', payload: { provider: 'codex-cli' } },
    { type: 'operator.cost_updated', entityType: 'mission', payload: { provider: 'codex-cli', authMode: 'local_codex' } },
  ]

  it('splits planner vs worker provider/auth evidence from overview events', () => {
    expect(buildProviderObservation(events)).toEqual({
      plannerProviders: ['claude-cli'],
      plannerFallbackObserved: false,
      plannerAuthModes: ['local_claude_code'],
      workerProviders: ['codex-cli'],
      workerAuthModes: ['local_codex'],
    })
  })

  it("detects the honest fallback marker planner_provider 'codex-cli (fallback)'", () => {
    const obs = buildProviderObservation([
      { type: 'operator.cost_updated', entityType: 'operator_session', payload: { scope: 'planner', provider: 'codex-cli', planner_provider: 'codex-cli (fallback)', authMode: 'local_codex' } },
    ])
    expect(obs.plannerFallbackObserved).toBe(true)
    expect(obs.plannerProviders).toEqual(['codex-cli'])
  })

  it('merges secondary evidence (run mode + model-usage.json) into the worker observation', () => {
    const obs = buildProviderObservation([], { latestRunMode: 'codex-cli', workerUsageProvider: 'codex-cli', workerUsageAuthMode: 'local_codex' })
    expect(obs.workerProviders).toEqual(['codex-cli'])
    expect(obs.workerAuthModes).toEqual(['local_codex'])
  })

  it('ignores non-planner cost scopes and unrelated events', () => {
    const obs = buildProviderObservation([
      { type: 'operator.cost_updated', entityType: 'operator_session', payload: { scope: 'reviewer', provider: 'claude-cli' } },
      { type: 'operator.evidence_written', entityType: 'mission', payload: { provider: 'bogus' } },
    ])
    expect(obs.plannerProviders).toEqual([])
    expect(obs.workerProviders).toEqual([])
  })
})

describe('cycle 1 — finalResultLabel', () => {
  const degraded = evaluateProviderPolicy('fallback-proof', FALLBACK_PLANNED)
  const strict = evaluateProviderPolicy('strict', STRICT_OK)

  it('clean strict run → PASS (strict); clean degraded run stays DEGRADED', () => {
    expect(finalResultLabel(strict, [])).toBe('PASS (strict)')
    expect(finalResultLabel(degraded, [])).toBe('DEGRADED (planner fallback)')
  })

  it('any other failure (safety, validator, regression) forces FAIL — even on a degraded run', () => {
    expect(finalResultLabel(strict, ['GEMINI_TIMEOUT: …'])).toBe('FAIL')
    expect(finalResultLabel(degraded, [`${REGRESSION_EVIDENCE_MISSING}: …`])).toBe('FAIL')
  })

  it('no verdict at all (planner hold / setup error) → FAIL', () => {
    expect(finalResultLabel(null, [])).toBe('FAIL')
  })
})

describe('cycle 2 — resolveValidatorTerminal', () => {
  it('not_configured is terminal', () => {
    expect(resolveValidatorTerminal({ validatorStatus: 'not_configured', validators: [] })).toBe('not_configured')
  })

  it('all verdicts pass → pass; any non-pass verdict → fail', () => {
    expect(resolveValidatorTerminal({ validatorStatus: 'complete', validators: [{ validator: 'gemini', verdict: 'pass' }] })).toBe('pass')
    expect(resolveValidatorTerminal({ validatorStatus: 'complete', validators: [{ validator: 'gemini', verdict: 'fail' }] })).toBe('fail')
    expect(resolveValidatorTerminal({
      validatorStatus: 'complete',
      validators: [{ validator: 'gemini', verdict: 'pass' }, { validator: 'openai', verdict: 'needs_human' }],
    })).toBe('fail')
  })

  it('pending → null (keep polling; never a vague terminal "pending")', () => {
    expect(resolveValidatorTerminal({ validatorStatus: 'pending', validators: [] })).toBeNull()
    expect(resolveValidatorTerminal({ validators: [] })).toBeNull()
  })
})

describe('cycle 2 — validatorFailure + expectedPrBlockCode', () => {
  const opts = { requireGeminiPass: false, timeoutMs: 180_000 }

  it('timeout → distinct GEMINI_TIMEOUT failure naming the timeout', () => {
    const f = validatorFailure('timeout', opts)
    expect(f).toContain('GEMINI_TIMEOUT')
    expect(f).toContain('180000ms')
  })

  it('fail → GEMINI_FAIL; pass → no failure', () => {
    expect(validatorFailure('fail', opts)).toContain('GEMINI_FAIL')
    expect(validatorFailure('pass', opts)).toBeNull()
  })

  it('not_configured is honest-acceptable unless a Gemini PASS is required', () => {
    expect(validatorFailure('not_configured', opts)).toBeNull()
    expect(validatorFailure('not_configured', { ...opts, requireGeminiPass: true })).toContain('GEMINI_NOT_CONFIGURED')
  })

  it('maps the expected create-pr block code per terminal state', () => {
    expect(expectedPrBlockCode('pass')).toBe('REMOTE_WRITES_DISABLED')
    expect(expectedPrBlockCode('fail')).toBe('GEMINI_NOT_PASS')
    expect(expectedPrBlockCode('not_configured')).toBe('GEMINI_NOT_CONFIGURED')
    expect(expectedPrBlockCode('timeout')).toBeNull()
    expect(expectedPrBlockCode(null)).toBeNull()
  })
})

describe('cycle 3 — parseRegressionEvidence', () => {
  it('accepts the docker runner-verified line with exit 0', () => {
    const out = parseRegressionEvidence({
      'test-summary.md': 'Runner-verified tests: `npm test` -> exit 0, 2 passed\nThe runner INDEPENDENTLY re-ran the repository test suite.',
    })
    expect(out.ok).toBe(true)
    expect(out.commands[0]).toMatchObject({ command: 'npm test', passed: true })
  })

  it('runner-verified exit 1 (or trailing "N failed") is an executed-but-failed command → not ok', () => {
    const out = parseRegressionEvidence({ 'test-summary.md': 'Runner-verified tests: `npm test` -> exit 1, 1 failed' })
    expect(out.ok).toBe(false)
    expect(out.commands[0]?.passed).toBe(false)
    expect(out.reason).toContain(REGRESSION_EVIDENCE_MISSING)
    expect(out.reason).toContain('none passed')
  })

  it('accepts a codex command_execution log line running npm test with exit_code 0', () => {
    const line = '{"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc \\"npm test\\"","aggregated_output":"1 passed","exit_code":0,"status":"completed"}}'
    const out = parseRegressionEvidence({ 'operator-run.log': line })
    expect(out.ok).toBe(true)
    expect(out.commands[0]?.source).toBe('operator-run.log')
  })

  it('ignores in-progress command_execution events (no exit_code) and non-test commands', () => {
    const out = parseRegressionEvidence({
      'operator-run.log': [
        '{"type":"item.started","item":{"type":"command_execution","command":"npm test","status":"in_progress"}}',
        '{"type":"item.completed","item":{"type":"command_execution","command":"ls -la","exit_code":0,"status":"completed"}}',
      ].join('\n'),
    })
    expect(out.ok).toBe(false)
    expect(out.commands).toEqual([])
  })

  it('accepts a report line naming the command with a pass signal; "0 failed" does not count as failure', () => {
    const out = parseRegressionEvidence({ 'done-report.md': 'Tests/checks: ran `npm test` — 2 passed, 0 failed' })
    expect(out.ok).toBe(true)
  })

  it('a report line with a fail signal records an executed-but-failed command', () => {
    const out = parseRegressionEvidence({ 'transcript-summary.md': 'Ran npm test: 1 failed' })
    expect(out.ok).toBe(false)
    expect(out.commands[0]?.passed).toBe(false)
  })

  it('absent evidence → REGRESSION_EVIDENCE_MISSING with the scanned files in the reason', () => {
    const out = parseRegressionEvidence({ 'test-summary.md': '# Test Summary\n\nWorker exit code: 0\nRepository files changed: 1' })
    expect(out.ok).toBe(false)
    expect(out.commands).toEqual([])
    expect(out.reason).toContain(REGRESSION_EVIDENCE_MISSING)
    expect(out.reason).toContain('test-summary.md')
  })

  it('a bare command mention without any outcome signal does not count', () => {
    const out = parseRegressionEvidence({ 'plan.md': 'Next I will run npm test to verify.' })
    expect(out.ok).toBe(false)
    expect(out.commands).toEqual([])
  })
})

describe('cycle 4 — resolveSourceRepoChoice + describeRepoSource', () => {
  it('defaults to the disposable sandbox', () => {
    const res = resolveSourceRepoChoice({})
    expect(res).toEqual({ ok: true, choice: { kind: 'sandbox' } })
  })

  it('SOURCE_REPO + REPO_NAME → registered repo (trimmed)', () => {
    const res = resolveSourceRepoChoice({ [SOURCE_REPO_ENV]: ' /repos/hermus-agent ', [REPO_NAME_ENV]: ' hermus-agent ' })
    expect(res).toEqual({ ok: true, choice: { kind: 'registered', path: '/repos/hermus-agent', name: 'hermus-agent' } })
  })

  it('REPO_NAME defaults to the path basename', () => {
    const res = resolveSourceRepoChoice({ [SOURCE_REPO_ENV]: '/repos/hermus-agent' })
    expect(res).toEqual({ ok: true, choice: { kind: 'registered', path: '/repos/hermus-agent', name: 'hermus-agent' } })
  })

  it('REPO_NAME without SOURCE_REPO is a clear setup error, never a silent sandbox run', () => {
    const res = resolveSourceRepoChoice({ [REPO_NAME_ENV]: 'hermus-agent' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain(SOURCE_REPO_ENV)
  })

  it('describeRepoSource records which path was used', () => {
    expect(describeRepoSource({ kind: 'sandbox' })).toBe('sandbox')
    expect(describeRepoSource({ kind: 'registered', path: '/repos/hermus-agent', name: 'hermus-agent' }))
      .toBe('registered:hermus-agent (/repos/hermus-agent)')
  })
})
