import { describe, it, expect } from 'vitest'
import { deriveUserState } from './user-state.js'
import { deriveLoopCard, type DeriveLoopCardInput, type LoopCard } from './loop-cards.js'

// v6-P1 — five-card loop communication protocol (WORKBOOK_v6 GR#11).
// The ordinary user sees exactly ONE of five card types, derived purely from
// the operator-view fields. Machine codes live only in the `machine`
// sub-object; visible text is calm, bilingual, and always answers
// "what happens next". Contract: docs/product/LOOP_COMMUNICATION_PROTOCOL.md.

function makeInput(stage: string, overrides: Partial<DeriveLoopCardInput> = {}): DeriveLoopCardInput {
  const activeHoldCodes = overrides.activeHolds?.map((h) => h.code) ?? []
  const userState = overrides.userState ?? deriveUserState({
    stage,
    activeHoldCodes,
    prGate: overrides.safetySummary?.prGate
      ? { status: overrides.safetySummary.prGate.status, code: overrides.safetySummary.prGate.code }
      : undefined,
    pendingQuestionCount: overrides.understanding?.questions.length ?? 0,
  })
  return {
    stage,
    userState,
    confidence: 60,
    summary: 'The mission is progressing through the cockpit workflow.',
    nextAction: 'Continue the next visible cockpit action.',
    prompt: 'add dark mode to the settings page',
    missionTitle: 'Dark mode',
    githubPrUrl: null,
    understanding: { roundsCompleted: 0, questions: [] },
    loopSummary: {
      whatChanged: [],
      testsRan: [],
      agents: [],
      validatorSaid: null,
      whyStoppedOrContinuing: userState.explanation,
    },
    lastActivity: { atIso: null, agoMs: null, phase: userState.state },
    safetySummary: { remoteWrites: 'disabled' },
    projectPulse: { progress: [], evidence: [] },
    activeHolds: [],
    ...overrides,
    ...(overrides.userState ? {} : { userState }),
  }
}

const VISIBLE_CODE = /HOLD-[A-Z]|GEMINI_NOT_PASS|REMOTE_WRITES_DISABLED|REPO_NOT_WHITELISTED|CLARIFY_GATE_BLOCKED|HTTP|409/

function visibleText(card: LoopCard): string {
  const rest: Record<string, unknown> = { ...card }
  delete rest['machine']
  return JSON.stringify(rest)
}

describe('deriveLoopCard — full userState → card-type matrix', () => {
  // Every one of the 10 user states maps to exactly one of the five cards.
  const matrix: Array<[stage: string, expectedState: string, expectedCard: LoopCard['type']]> = [
    ['intake', 'understanding', 'understanding'],
    ['brainstorming', 'understanding', 'understanding'],
    ['clarifying', 'needs_more_context', 'understanding'],
    ['planning', 'planning', 'plan'],
    ['roadmap_ready', 'waiting_for_approval', 'plan'],
    ['pending_approval', 'waiting_for_approval', 'plan'],
    ['approved', 'ready_to_execute', 'progress'],
    ['running', 'executing', 'progress'],
    ['evidence_ready', 'testing', 'progress'],
    ['validating', 'testing', 'progress'],
    ['validators_ready', 'evaluating', 'progress'],
    ['validators_missing', 'evaluating', 'progress'],
    ['failed', 'blocked', 'blocker'],
    ['cancelled', 'blocked', 'blocker'],
    ['pr_blocked', 'blocked', 'blocker'],
    ['pr_ready', 'waiting_for_approval', 'pr_ready'],
    ['pr_created', 'completed', 'pr_ready'],
    ['learned', 'completed', 'pr_ready'],
  ]

  it.each(matrix)('stage %s (userState %s) → exactly one %s card', (stage, expectedState, expectedCard) => {
    const input = makeInput(stage)
    expect(input.userState.state).toBe(expectedState)
    const card = deriveLoopCard(input)
    expect(card.type).toBe(expectedCard)
  })

  it('covers all 10 user states', () => {
    const states = new Set(matrix.map(([stage]) => makeInput(stage).userState.state))
    expect([...states].sort()).toEqual([
      'blocked', 'completed', 'evaluating', 'executing', 'needs_more_context',
      'planning', 'ready_to_execute', 'testing', 'understanding', 'waiting_for_approval',
    ])
  })

  it('every card answers "what happens next" with a non-empty next_step and bilingual title', () => {
    for (const [stage] of matrix) {
      const card = deriveLoopCard(makeInput(stage))
      expect(card.next_step.length).toBeGreaterThan(0)
      expect(card.title.length).toBeGreaterThan(0)
    }
  })

  it('every card keeps the raw state/stage in the machine sub-object only', () => {
    for (const [stage, expectedState] of matrix) {
      const card = deriveLoopCard(makeInput(stage))
      expect(card.machine.user_state).toBe(expectedState)
      expect(card.machine.stage).toBe(stage)
    }
  })
})

describe('UnderstandingCard — populated from the clarification fields', () => {
  it('carries goal, interpreted goal, confidence, questions, and default assumptions', () => {
    const card = deriveLoopCard(makeInput('clarifying', {
      confidence: 72,
      understanding: {
        roundsCompleted: 1,
        questions: [
          { id: 'q1', question: 'Which page is the target?', options: [{ label: 'Settings', recommended: true }, { label: 'Home' }] },
          { id: 'q2', question: 'Dark mode toggle placement?', options: [{ label: 'Header' }] },
        ],
      },
    }))
    if (card.type !== 'understanding') throw new Error(`expected understanding, got ${card.type}`)
    expect(card.user_goal).toBe('add dark mode to the settings page')
    expect(card.interpreted_goal.length).toBeGreaterThan(0)
    expect(card.confidence).toBe(72)
    expect(card.questions).toEqual([
      { id: 'q1', question: 'Which page is the target?' },
      { id: 'q2', question: 'Dark mode toggle placement?' },
    ])
    expect(card.default_assumptions).toHaveLength(1)
    expect(card.default_assumptions[0]).toContain('Settings')
    expect(Array.isArray(card.out_of_scope)).toBe(true)
  })
})

describe('PlanCard — approval-gated, deterministic risk', () => {
  it('always requires approval and derives phases from the project pulse', () => {
    const card = deriveLoopCard(makeInput('pending_approval', {
      projectPulse: { progress: [{ label: 'Understand' }, { label: 'Plan' }, { label: 'Execute' }], evidence: [] },
    }))
    if (card.type !== 'plan') throw new Error(`expected plan, got ${card.type}`)
    expect(card.requires_approval).toBe(true)
    expect(card.objective).toBe('add dark mode to the settings page')
    expect(card.phases).toEqual(['Understand', 'Plan', 'Execute'])
    expect(card.estimated_calls).toBeGreaterThan(0)
    expect(card.acceptance_criteria.length).toBeGreaterThan(0)
  })

  it('risk is low with remote writes disabled and medium when enabled', () => {
    const low = deriveLoopCard(makeInput('pending_approval'))
    const medium = deriveLoopCard(makeInput('pending_approval', { safetySummary: { remoteWrites: 'enabled' } }))
    if (low.type !== 'plan' || medium.type !== 'plan') throw new Error('expected plan cards')
    expect(low.risk_level).toBe('low')
    expect(medium.risk_level).toBe('medium')
  })
})

describe('ProgressCard — evidence and tests from the loop summary', () => {
  it('links evidence, tests run, and the current action', () => {
    const card = deriveLoopCard(makeInput('running', {
      loopSummary: {
        whatChanged: ['src/a.ts'],
        testsRan: ['unit gate'],
        agents: ['worker · codex-cli'],
        validatorSaid: null,
        whyStoppedOrContinuing: 'AI 正在按方案干活 · The AI is working through the plan.',
      },
      projectPulse: { progress: [], evidence: [{ path: '/tmp/evidence/run-1/diff.patch' }] },
    }))
    if (card.type !== 'progress') throw new Error(`expected progress, got ${card.type}`)
    expect(card.current_phase.length).toBeGreaterThan(0)
    expect(card.current_action).toContain('working through the plan')
    expect(card.evidence_links).toEqual(['/tmp/evidence/run-1/diff.patch'])
    expect(card.tests_run).toEqual(['unit gate'])
    expect(card.next_step.length).toBeGreaterThan(0)
  })
})

describe('BlockerCard — human wording only; raw codes live in machine', () => {
  it('HOLD-BUDGET: visible text reuses the user-state phrasing and carries zero raw codes', () => {
    const card = deriveLoopCard(makeInput('running', {
      activeHolds: [{ code: 'HOLD-BUDGET', reason: 'daily cap reached' }],
    }))
    if (card.type !== 'blocker') throw new Error(`expected blocker, got ${card.type}`)
    expect(card.human_explanation).toContain('今日预算已用完')
    expect(visibleText(card)).not.toMatch(VISIBLE_CODE)
    expect(card.machine.hold_code).toBe('HOLD-BUDGET')
    expect(card.recovery_actions.length).toBeGreaterThan(0)
    expect(card.recommended_action).toBe(card.recovery_actions[0])
    expect(card.why_it_matters.length).toBeGreaterThan(0)
  })

  it('pr_blocked safety gate: code only in machine.pr_gate_code; explanation is calm', () => {
    const card = deriveLoopCard(makeInput('pr_blocked', {
      safetySummary: {
        remoteWrites: 'disabled',
        prGate: { status: 'blocked', code: 'REMOTE_WRITES_DISABLED', reason: 'policy gate' },
      },
    }))
    if (card.type !== 'blocker') throw new Error(`expected blocker, got ${card.type}`)
    expect(visibleText(card)).not.toMatch(VISIBLE_CODE)
    expect(card.machine.pr_gate_code).toBe('REMOTE_WRITES_DISABLED')
    expect(card.human_explanation).toContain('等待你确认')
  })

  it('HOLD-PLANNER-AUTH blocker: recovery actions carry the exact one-line fixes, never raw 401/codes', () => {
    const card = deriveLoopCard(makeInput('brainstorming', {
      activeHolds: [{ code: 'HOLD-PLANNER-AUTH', reason: 'claude-cli auth failure (matched 401)' }],
    }))
    if (card.type !== 'blocker') throw new Error(`expected blocker, got ${card.type}`)
    const joined = card.recovery_actions.join('\n')
    expect(joined).toContain('claude login')
    expect(joined).toContain('/status')
    expect(joined).toContain('AEDEV_PLANNER_FALLBACK=codex')
    expect(card.recommended_action).toContain('claude login')
    expect(visibleText(card)).not.toMatch(VISIBLE_CODE)
    expect(visibleText(card)).not.toContain('401')
    expect(card.machine.hold_code).toBe('HOLD-PLANNER-AUTH')
  })

  it('every blocker variant in the matrix keeps visible text code-free', () => {
    const variants: DeriveLoopCardInput[] = [
      makeInput('failed'),
      makeInput('cancelled'),
      makeInput('running', { activeHolds: [{ code: 'HOLD-REVIEW-LOOP', reason: 'x' }] }),
      makeInput('running', { activeHolds: [{ code: 'HOLD-SESSION-POOL', reason: 'x' }] }),
      makeInput('running', { activeHolds: [{ code: 'HOLD-TARGET-REPO-UNAVAILABLE', reason: 'x' }] }),
    ]
    for (const input of variants) {
      const card = deriveLoopCard(input)
      expect(card.type).toBe('blocker')
      expect(visibleText(card)).not.toMatch(VISIBLE_CODE)
    }
  })
})

describe('PrReadyCard — honest evidence, human merge only', () => {
  it('reports the real PR URL, files, tests, and verdict when present', () => {
    const card = deriveLoopCard(makeInput('pr_created', {
      githubPrUrl: 'https://github.com/acme/repo/pull/12',
      loopSummary: {
        whatChanged: ['src/a.ts', 'src/b.ts'],
        testsRan: ['unit gate', 'lint gate'],
        agents: [],
        validatorSaid: 'gemini: pass — evidence proves the change',
        whyStoppedOrContinuing: 'done',
      },
    }))
    if (card.type !== 'pr_ready') throw new Error(`expected pr_ready, got ${card.type}`)
    expect(card.pr_url).toBe('https://github.com/acme/repo/pull/12')
    expect(card.files_changed).toEqual(['src/a.ts', 'src/b.ts'])
    expect(card.tests).toEqual(['unit gate', 'lint gate'])
    expect(card.validator_verdict).toContain('pass')
    expect(card.rework_button.enabled).toBe(true)
    expect(card.rework_button.label.length).toBeGreaterThan(0)
  })

  it('merge policy always states human-merge-only; missing PR/verdict stay null (no fabrication)', () => {
    const card = deriveLoopCard(makeInput('pr_ready'))
    if (card.type !== 'pr_ready') throw new Error(`expected pr_ready, got ${card.type}`)
    expect(card.merge_policy).toMatch(/human/i)
    expect(card.merge_policy).toContain('永不')
    expect(card.pr_url).toBeNull()
    expect(card.validator_verdict).toBeNull()
  })
})
