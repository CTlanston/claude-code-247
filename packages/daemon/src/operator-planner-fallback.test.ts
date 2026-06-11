import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import type { ClaudeRunResult, CodexRunOptions, CodexRunResult } from '@aedev/runner'
import { runLocalPlannerText, runPlannerMissionDesign, type PlannerAdapterDeps } from './routes/operator.js'
import { HEADLESS_CALL_EVENT } from './headless-budget-guard.js'

// overnight-p1 — honest planner auth failure + opt-in codex fallback.
//
// Real failure being fixed: `claude -p` → 401 on the operator's Mac, and the
// cockpit raised a confusing generic HOLD-PLANNER-CLI. Contract under test:
//  1. auth-looking failures emit HOLD-PLANNER-AUTH with the matched hint;
//  2. AEDEV_PLANNER_FALLBACK=codex (explicit opt-in ONLY) retries ONCE via the
//     local codex CLI in read-only exec mode, recorded honestly as
//     `planner_provider: codex-cli (fallback)` — never pretending it was claude;
//  3. fallback unset → codex is NEVER attempted; no template is substituted;
//  4. there is NO paid-API fallback of any kind.
//
// All adapters here are fakes (GR#8): no real CLI is ever spawned.

const ENV_KEYS = [
  'AEDEV_PLANNER_FALLBACK',
  'AEDEV_COCKPIT_PLANNER_PROVIDER',
  'AEDEV_COCKPIT_PLANNER_FIXTURE_JSON',
  'AEDEV_COCKPIT_FORCE_TEMPLATE',
  'AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION',
  'AEDEV_BUDGET_MAX_HEADLESS_PER_DAY',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const CLAUDE_401_STDERR =
  'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired. Please run /login."}}'

function claudeResult(over: Partial<ClaudeRunResult> = {}): ClaudeRunResult {
  return {
    transcript: '',
    exitCode: 1,
    durationMs: 25,
    authMode: 'local_claude_code',
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
    rawJson: {},
    error: CLAUDE_401_STDERR,
    ...over,
  }
}

function codexResult(over: Partial<CodexRunResult> = {}): CodexRunResult {
  return {
    transcript: 'codex says hi',
    exitCode: 0,
    durationMs: 30,
    authMode: 'local_codex',
    costUsd: null,
    inputTokens: 5,
    outputTokens: 9,
    rawJson: {},
    ...over,
  }
}

function fakeClaude(result: ClaudeRunResult): NonNullable<PlannerAdapterDeps['claude']> {
  return { isAvailable: async () => true, run: async () => result }
}

interface CodexCall { prompt: string; workdir: string; options: CodexRunOptions }

function fakeCodex(result: CodexRunResult): { adapter: NonNullable<PlannerAdapterDeps['codex']>; calls: CodexCall[] } {
  const calls: CodexCall[] = []
  return {
    calls,
    adapter: {
      isAvailable: async () => true,
      run: async (prompt: string, workdir: string, options: CodexRunOptions = {}) => {
        calls.push({ prompt, workdir, options })
        return result
      },
    },
  }
}

describe('runLocalPlannerText — distinct HOLD-PLANNER-AUTH on claude auth failure', () => {
  it('claude 401 with NO fallback env → HOLD-PLANNER-AUTH (not generic), matched hint in reason, no codex attempt, no template', async () => {
    const codex = fakeCodex(codexResult())
    const out = await runLocalPlannerText('sys', 'plan it', 'planner', 'add dark mode', undefined, {
      claude: fakeClaude(claudeResult()),
      codex: codex.adapter,
    })
    expect(out.event['holdCode']).toBe('HOLD-PLANNER-AUTH')
    const failures = (out.event['failures'] as string[]).join('; ')
    expect(failures).toContain("matched '401'")
    expect(failures).toContain('401')
    // Regression (template never impersonates): real mode substitutes NO synthetic brainstorm.
    expect(out.content).not.toContain('Initial brainstorm:')
    expect(out.content).toContain('HOLD-PLANNER-AUTH')
    expect(out.content).toContain('claude login')
    expect(out.content).toContain('AEDEV_PLANNER_FALLBACK=codex')
    // Fallback unset → codex must never be attempted.
    expect(codex.calls).toHaveLength(0)
  })

  it('a non-auth claude failure stays HOLD-PLANNER-CLI', async () => {
    const out = await runLocalPlannerText('sys', 'plan it', 'planner', 'goal', undefined, {
      claude: fakeClaude(claudeResult({ exitCode: -1, error: 'spawn failed: ENOENT' })),
    })
    expect(out.event['holdCode']).toBe('HOLD-PLANNER-CLI')
  })
})

describe('runLocalPlannerText — AEDEV_PLANNER_FALLBACK=codex (explicit opt-in)', () => {
  it('claude 401 + fallback env → ONE codex retry in read-only exec mode, recorded as codex-cli (fallback)', async () => {
    process.env['AEDEV_PLANNER_FALLBACK'] = 'codex'
    const db = new AedevDb(':memory:')
    const codex = fakeCodex(codexResult({ transcript: 'Brainstorm via codex\n\n1. option A' }))
    const out = await runLocalPlannerText('sys prompt', 'plan it', 'planner', 'goal', { db, sessionId: 's1' }, {
      claude: fakeClaude(claudeResult()),
      codex: codex.adapter,
    })
    // Honest output: content from codex, provider recorded as the fallback — never claude.
    expect(out.content).toContain('Brainstorm via codex')
    expect(out.event['holdCode']).toBeUndefined()
    expect(out.event['provider']).toBe('codex-cli')
    expect(out.event['planner_provider']).toBe('codex-cli (fallback)')
    expect(out.event['fallbackFrom']).toBe('claude-cli')
    expect(out.event['authMode']).toBe('local_codex')
    // Exactly one retry, mirroring the probe contract: read-only sandbox, never-approve.
    expect(codex.calls).toHaveLength(1)
    expect(codex.calls[0]!.options.sandbox).toBe('read-only')
    expect(codex.calls[0]!.options.approvalPolicy).toBe('never')
    expect(codex.calls[0]!.prompt).toContain('sys prompt')
    expect(codex.calls[0]!.prompt).toContain('plan it')
    // The metered headless call is recorded with provider codex-cli (role unchanged).
    const events = db.queryEvents({ type: HEADLESS_CALL_EVENT })
    const codexCall = events.find((e) => e.payload['provider'] === 'codex-cli')
    expect(codexCall).toBeDefined()
    expect(codexCall!.payload['role']).toBe('planner')
  })

  it('claude 401 + fallback env but codex also fails → HOLD-PLANNER-AUTH with both failures', async () => {
    process.env['AEDEV_PLANNER_FALLBACK'] = 'codex'
    const codex = fakeCodex(codexResult({ exitCode: 1, transcript: '', error: 'stream error: unexpected status 401' }))
    const out = await runLocalPlannerText('sys', 'plan it', 'planner', 'goal', undefined, {
      claude: fakeClaude(claudeResult()),
      codex: codex.adapter,
    })
    expect(codex.calls).toHaveLength(1)
    expect(out.event['holdCode']).toBe('HOLD-PLANNER-AUTH')
    const failures = (out.event['failures'] as string[]).join('; ')
    expect(failures).toContain('codex-cli (fallback)')
  })

  it('claude healthy → codex is never consulted even with the fallback env set', async () => {
    process.env['AEDEV_PLANNER_FALLBACK'] = 'codex'
    const codex = fakeCodex(codexResult())
    const out = await runLocalPlannerText('sys', 'plan it', 'planner', 'goal', undefined, {
      claude: fakeClaude(claudeResult({ exitCode: 0, transcript: 'real claude plan', error: undefined })),
      codex: codex.adapter,
    })
    expect(out.event['provider']).toBe('claude-cli')
    expect(out.event['planner_provider']).toBeUndefined()
    expect(codex.calls).toHaveLength(0)
  })
})

describe('runPlannerMissionDesign — auth hold + opt-in fallback (real mode)', () => {
  beforeEach(() => {
    // pnpm test forces the deterministic template; these tests pin the REAL path.
    process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '0'
  })

  it('claude 401 with NO fallback env → ok:false with holdCode HOLD-PLANNER-AUTH and the 401 reason', async () => {
    const codex = fakeCodex(codexResult())
    const out = await runPlannerMissionDesign('add dark mode', 'Dark mode', 'r1', 'm1', '', undefined, {
      claude: fakeClaude(claudeResult()),
      codex: codex.adapter,
    })
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected failure')
    expect(out.holdCode).toBe('HOLD-PLANNER-AUTH')
    expect(out.reason).toContain('401')
    expect(codex.calls).toHaveLength(0)
  })

  it('claude 401 + AEDEV_PLANNER_FALLBACK=codex → design parsed from the codex fenced-JSON contract, provider honest', async () => {
    process.env['AEDEV_PLANNER_FALLBACK'] = 'codex'
    const codex = fakeCodex(codexResult({
      transcript: 'Here is the design:\n```json\n{"missionId":"m1","title":"Dark mode"}\n```\n',
    }))
    const out = await runPlannerMissionDesign('add dark mode', 'Dark mode', 'r1', 'm1', '', undefined, {
      claude: fakeClaude(claudeResult()),
      codex: codex.adapter,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected success')
    expect(out.design).toEqual({ missionId: 'm1', title: 'Dark mode' })
    expect(out.provider).toBe('codex-cli')
    expect(out.plannerProvider).toBe('codex-cli (fallback)')
    expect(codex.calls).toHaveLength(1)
    expect(codex.calls[0]!.options.sandbox).toBe('read-only')
  })
})
