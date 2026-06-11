import { describe, it, expect } from 'vitest'
import { deriveUserState, type UserState } from './user-state.js'

// v-ux-1 — non-developer UX state model. The cockpit is for NON-developers:
// raw HTTP codes, validator codes, and stack traces must never reach the
// primary chat flow. This matrix pins the stage→state mapping and the human
// (bilingual) explanations.

function derive(stage: string, extra: Partial<Parameters<typeof deriveUserState>[0]> = {}) {
  return deriveUserState({ stage, activeHoldCodes: [], ...extra })
}

describe('deriveUserState — stage mapping matrix', () => {
  const cases: Array<[string, UserState]> = [
    ['intake', 'understanding'],
    ['new', 'understanding'],
    ['understanding', 'understanding'],
    ['brainstorming', 'understanding'],
    ['clarifying', 'needs_more_context'],
    ['roadmap_ready', 'waiting_for_approval'],
    ['pending_approval', 'waiting_for_approval'],
    ['approved', 'ready_to_execute'],
    ['running', 'executing'],
    ['evidence_ready', 'testing'],
    ['validating', 'testing'],
    ['validators_ready', 'evaluating'],
    ['validators_missing', 'evaluating'],
    ['pr_blocked', 'blocked'],
    ['pr_ready', 'waiting_for_approval'],
    ['pr_created', 'completed'],
    ['learned', 'completed'],
    ['failed', 'blocked'],
    ['cancelled', 'blocked'],
  ]
  it.each(cases)('maps stage %s → %s', (stage, expected) => {
    expect(derive(stage).state).toBe(expected)
  })

  it('understanding_ready with pending questions → needs_more_context', () => {
    expect(derive('understanding_ready', { pendingQuestionCount: 2 }).state).toBe('needs_more_context')
  })

  it('understanding_ready with no pending questions → planning (roadmap generation can start)', () => {
    expect(derive('understanding_ready', { pendingQuestionCount: 0 }).state).toBe('planning')
  })

  it('roadmap generation in flight → planning', () => {
    expect(derive('planning').state).toBe('planning')
    expect(derive('generating_roadmap').state).toBe('planning')
  })

  it('every state carries a bilingual label and a non-empty explanation', () => {
    for (const [stage] of cases) {
      const v = derive(stage)
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.labelZh.length).toBeGreaterThan(0)
      expect(v.explanation.length).toBeGreaterThan(0)
    }
  })
})

describe('deriveUserState — validators_missing is honest, never an error', () => {
  it('explains the missing review as not-configured, with no error wording', () => {
    const v = derive('validators_missing', { validatorStatus: 'not_configured' })
    expect(v.state).toBe('evaluating')
    expect(v.explanation).toContain('结果评审尚未配置')
    expect(v.explanation).toContain('result review not configured')
    expect(v.explanation).not.toMatch(/error|fail|crash/i)
  })
})

describe('deriveUserState — blocked with HUMAN explanations from hold codes', () => {
  it('HOLD-BUDGET → budget exhausted wording', () => {
    const v = derive('running', { activeHoldCodes: ['HOLD-BUDGET'] })
    expect(v.state).toBe('blocked')
    expect(v.explanation).toContain('今日预算已用完，明天自动恢复或调高预算')
  })

  it('HOLD-REVIEW-LOOP → human-review wording', () => {
    const v = derive('running', { activeHoldCodes: ['HOLD-REVIEW-LOOP'] })
    expect(v.state).toBe('blocked')
    expect(v.explanation).toContain('自动修复多次未通过，需要人看一眼')
  })

  it('HOLD-SESSION-POOL → local engine wording', () => {
    const v = derive('approved', { activeHoldCodes: ['HOLD-SESSION-POOL'] })
    expect(v.state).toBe('blocked')
    expect(v.explanation).toContain('本地 AI 引擎未就绪')
  })

  it('HOLD-PLANNER-AUTH → calm re-login wording with the exact one-line fix, never raw 401', () => {
    const v = derive('brainstorming', { activeHoldCodes: ['HOLD-PLANNER-AUTH'] })
    expect(v.state).toBe('blocked')
    expect(v.explanation).toContain('本地 Claude 登录已过期或额度用尽')
    expect(v.explanation).toContain('claude login')
    expect(v.explanation).not.toMatch(/401|unauthorized|HOLD-/i)
  })

  it('any other active HOLD-* → blocked with a calm generic fallback, never the raw code', () => {
    const v = derive('running', { activeHoldCodes: ['HOLD-ROADMAP-PLANNER'] })
    expect(v.state).toBe('blocked')
    expect(v.explanation).not.toContain('HOLD-')
    expect(v.explanation.length).toBeGreaterThan(0)
  })

  it('pr_blocked with a safety-gate code → calm safety phrasing, not an error', () => {
    for (const code of ['GEMINI_NOT_PASS', 'REMOTE_WRITES_DISABLED', 'REPO_NOT_WHITELISTED']) {
      const v = derive('pr_blocked', { prGate: { status: 'blocked', code } })
      expect(v.state).toBe('blocked')
      expect(v.explanation).toContain('改动已完成并通过检查，等待你确认后才会对外发布')
      expect(v.explanation).not.toContain(code)
    }
  })

  it('pr_blocked without a code still gets the calm safety phrasing', () => {
    const v = derive('pr_blocked', { prGate: { status: 'blocked' } })
    expect(v.state).toBe('blocked')
    expect(v.explanation).toContain('等待你确认')
  })

  it('failed/cancelled use gentle wording without raw codes or stack traces', () => {
    for (const stage of ['failed', 'cancelled']) {
      const v = derive(stage)
      expect(v.state).toBe('blocked')
      expect(v.explanation).not.toMatch(/HTTP|409|exit|stack|trace|Error:/i)
    }
  })
})

describe('deriveUserState — north star: no raw codes anywhere', () => {
  it('label/labelZh/explanation never leak HTTP, gate or validator codes', () => {
    const samples = [
      derive('pr_blocked', { prGate: { status: 'blocked', code: 'GEMINI_NOT_PASS' } }),
      derive('running', { activeHoldCodes: ['HOLD-BUDGET'] }),
      derive('clarifying'),
      derive('validators_missing'),
      derive('totally_unknown_stage'),
    ]
    for (const v of samples) {
      for (const text of [v.label, v.labelZh, v.explanation]) {
        expect(text).not.toMatch(/HTTP|409|CLARIFY_GATE_BLOCKED|GEMINI_NOT_PASS|REMOTE_WRITES_DISABLED|HOLD-[A-Z]/)
      }
    }
  })

  it('an unknown stage falls back to a safe state instead of throwing', () => {
    const v = derive('totally_unknown_stage')
    expect(v.state).toBe('understanding')
  })
})
