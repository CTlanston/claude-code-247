// @vitest-environment jsdom
/**
 * v6-P2 — card cockpit: the ordinary user only ever sees the five loop cards
 * (understanding / plan / progress / blocker / pr_ready) as the primary state
 * surface. Contract: docs/product/LOOP_COMMUNICATION_PROTOCOL.md (GR#11).
 *
 * Pinned invariants:
 *  - each card type renders with data-card-type and calm bilingual text;
 *  - every card shows its `next_step` prominently (cockpit-loop-card-next-step);
 *  - the `machine` sub-object is NEVER rendered as visible text — raw codes
 *    (HOLD-*, gate codes, stage tokens) live only in data-* attributes.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LoopCard } from './LoopCard.js'
import type {
  ApiBlockerLoopCard,
  ApiLoopCard,
  ApiLoopCardMachine,
  ApiPlanLoopCard,
  ApiPrReadyLoopCard,
  ApiProgressLoopCard,
  ApiUnderstandingLoopCard,
} from '../../api.js'

afterEach(cleanup)

const MACHINE: ApiLoopCardMachine = {
  user_state: 'blocked',
  stage: 'pr_blocked',
  hold_code: 'HOLD-BUDGET',
  pr_gate_code: 'REMOTE_WRITES_DISABLED',
}

function understanding(): ApiUnderstandingLoopCard {
  return {
    type: 'understanding',
    title: '正在理解你的目标 · Understanding your goal',
    next_step: '回答上面的问题，AI 才能继续生成方案 · Answer the questions above so the plan can continue.',
    machine: { user_state: 'needs_more_context', stage: 'clarifying', hold_code: null, pr_gate_code: null },
    user_goal: 'Make onboarding calmer',
    interpreted_goal: 'AI 正在阅读你的目标 · The AI is reading your goal.',
    out_of_scope: [],
    confidence: 62,
    questions: [{ id: 'q1', question: 'Which slice first?' }],
    default_assumptions: ['不回答时默认采用 · If unanswered, the default is "Smallest viable slice".'],
  }
}

function plan(): ApiPlanLoopCard {
  return {
    type: 'plan',
    title: '等待你的确认 · Waiting for your go-ahead',
    next_step: '审阅这份方案；你批准后才会开始动手 · Review this plan; work starts only after you approve it.',
    machine: { user_state: 'waiting_for_approval', stage: 'roadmap_ready', hold_code: null, pr_gate_code: null },
    objective: 'Improve one onboarding message',
    phases: ['Understand · 理解需求', 'Execute · 本地执行'],
    acceptance_criteria: ['gate.json'],
    risk_level: 'low',
    estimated_calls: 15,
    requires_approval: true,
  }
}

function progress(): ApiProgressLoopCard {
  return {
    type: 'progress',
    title: '正在执行 · Working on it',
    next_step: 'Watch progress here; evidence lands automatically · 进度会自动更新。',
    machine: { user_state: 'executing', stage: 'running', hold_code: null, pr_gate_code: null },
    current_phase: '正在执行 · Working on it',
    current_action: 'worker 正在按方案干活 · The worker is following the plan.',
    evidence_links: ['evidence/run-1/gate.json'],
    tests_run: ['typecheck', 'vitest'],
  }
}

function blocker(): ApiBlockerLoopCard {
  return {
    type: 'blocker',
    title: '需要你处理 · Needs your attention',
    next_step: '等到明天额度自动恢复 · Wait for the allowance to reset tomorrow.',
    machine: MACHINE,
    human_explanation: '今日预算已用完，明天自动恢复或调高预算 · Today’s budget is used up; it resets tomorrow, or you can raise the limit.',
    why_it_matters: '预算护栏防止系统超额消耗调用额度 · The budget guard stops silent overspend.',
    recovery_actions: ['等到明天额度自动恢复 · Wait for the reset.', '调高今日预算 · Raise today’s budget.'],
    recommended_action: '等到明天额度自动恢复 · Wait for the reset.',
  }
}

function prReady(withUrl: boolean): ApiPrReadyLoopCard {
  return {
    type: 'pr_ready',
    title: '已完成 · Done',
    next_step: '去 GitHub 审阅这个 Draft PR；merge 由你亲自点 · Review the draft PR; merging is yours.',
    machine: { user_state: 'completed', stage: 'pr_created', hold_code: null, pr_gate_code: null },
    pr_url: withUrl ? 'https://github.com/o/r/pull/7' : null,
    summary: '本轮工作已完成 · This round of work is complete.',
    files_changed: ['src/a.ts'],
    tests: ['vitest'],
    validator_verdict: null,
    risk: 'low',
    merge_policy: '只有你能 merge · Human merge only: the system never merges.',
    rework_button: { enabled: true, label: '不满意？让 AI 返工 · Not satisfied? Ask for rework.' },
  }
}

function renderCard(card: ApiLoopCard) {
  const { container } = render(<LoopCard card={card} />)
  const root = container.querySelector('[data-testid="cockpit-loop-card"]') as HTMLElement
  expect(root).toBeTruthy()
  return root
}

describe('LoopCard — five card types render with a prominent next_step', () => {
  const cases: Array<[string, ApiLoopCard]> = [
    ['understanding', understanding()],
    ['plan', plan()],
    ['progress', progress()],
    ['blocker', blocker()],
    ['pr_ready', prReady(false)],
  ]

  for (const [type, card] of cases) {
    it(`renders the ${type} card with data-card-type and visible next_step`, () => {
      const root = renderCard(card)
      expect(root.getAttribute('data-card-type')).toBe(type)
      const next = root.querySelector('[data-testid="cockpit-loop-card-next-step"]') as HTMLElement
      expect(next).toBeTruthy()
      expect(next.textContent).toContain(card.next_step)
      expect(root.textContent).toContain(card.title)
    })
  }
})

describe('LoopCard — per-type content', () => {
  it('understanding: shows goal, interpreted goal, questions and default assumptions', () => {
    const root = renderCard(understanding())
    expect(root.textContent).toContain('Make onboarding calmer')
    expect(root.textContent).toContain('The AI is reading your goal')
    expect(root.textContent).toContain('Which slice first?')
    expect(root.textContent).toContain('Smallest viable slice')
    expect(root.textContent).toContain('62')
  })

  it('plan: shows objective, phases, acceptance criteria, and the approval requirement', () => {
    const root = renderCard(plan())
    expect(root.textContent).toContain('Improve one onboarding message')
    expect(root.textContent).toContain('Understand · 理解需求')
    expect(root.textContent).toContain('gate.json')
    // requires_approval=true must be visible as calm human text
    expect(root.textContent).toMatch(/批准|approve/i)
  })

  it('progress: shows current action, checks, and evidence links', () => {
    const root = renderCard(progress())
    expect(root.textContent).toContain('The worker is following the plan')
    expect(root.textContent).toContain('typecheck')
    expect(root.textContent).toContain('evidence/run-1/gate.json')
  })

  it('pr_ready: honest about a missing PR url and missing verdict; merge policy always visible', () => {
    const root = renderCard(prReady(false))
    expect(root.textContent).toContain('Human merge only')
    expect(root.textContent).toMatch(/尚未创建|No draft PR/)
    expect(root.textContent).toMatch(/还没有结论|No review verdict/)
    expect(root.querySelector('a')).toBeNull()
  })

  it('pr_ready: renders the PR link when a real url exists', () => {
    const root = renderCard(prReady(true))
    const link = root.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://github.com/o/r/pull/7')
  })
})

describe('LoopCard — blocker card: human explanation, never raw codes', () => {
  it('shows human_explanation, why_it_matters and recovery actions', () => {
    const root = renderCard(blocker())
    expect(root.textContent).toContain('今日预算已用完')
    expect(root.textContent).toContain('The budget guard stops silent overspend')
    expect(root.textContent).toContain('Raise today’s budget')
  })

  it('never renders raw machine codes as visible text; they stay in data-* attributes', () => {
    const root = renderCard(blocker())
    expect(root.textContent).not.toContain('HOLD-BUDGET')
    expect(root.textContent).not.toContain('REMOTE_WRITES_DISABLED')
    expect(root.textContent).not.toContain('pr_blocked')
    expect(root.getAttribute('data-hold-code')).toBe('HOLD-BUDGET')
    expect(root.getAttribute('data-pr-gate-code')).toBe('REMOTE_WRITES_DISABLED')
    expect(root.getAttribute('data-machine-stage')).toBe('pr_blocked')
    expect(root.getAttribute('data-user-state')).toBe('blocked')
  })

  it('keeps machine tokens out of visible text for every card type', () => {
    const cards: ApiLoopCard[] = [understanding(), plan(), progress(), blocker(), prReady(false)]
    for (const card of cards) {
      const root = renderCard(card)
      for (const token of [card.machine.user_state, card.machine.stage, card.machine.hold_code, card.machine.pr_gate_code]) {
        if (!token) continue
        expect(root.textContent).not.toContain(token)
      }
      cleanup()
    }
  })
})
