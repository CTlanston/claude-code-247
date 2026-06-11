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
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
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

// ---- overnight-p3 — operator console upgrades -------------------------------
// The five cards must tell a new user what the system is doing and what to do
// next WITHOUT logs: operator vocabulary titles, an agent strip, the primary
// action ON the card, evidence entries, and PR-gate transparency.

function progressAt(stage: string): ApiProgressLoopCard {
  const card = progress()
  card.machine = { ...card.machine, stage }
  return card
}

function gateBlocker(code: string): ApiBlockerLoopCard {
  const card = blocker()
  card.machine = { user_state: 'blocked', stage: 'pr_blocked', hold_code: null, pr_gate_code: code }
  card.human_explanation = '为了安全，PR 暂时不能开 · For safety the draft PR cannot be opened yet.'
  return card
}

describe('LoopCard — operator vocabulary titles (理解/计划/构建/验证/合并)', () => {
  it('maps card types to the operator stage vocabulary', () => {
    expect(renderCard(understanding()).textContent).toContain('理解 · Understand')
    cleanup()
    expect(renderCard(plan()).textContent).toContain('计划 · Plan')
    cleanup()
    expect(renderCard(prReady(false)).textContent).toContain('合并 · PR·Merge')
  })

  it('progress splits VISUALLY into Build (running) vs Verify (evidence/validating); data-card-type stays progress', () => {
    const build = renderCard(progressAt('running'))
    expect(build.textContent).toContain('构建 · Build')
    expect(build.textContent).not.toContain('验证 · Verify')
    expect(build.getAttribute('data-card-type')).toBe('progress')
    cleanup()
    for (const stage of ['evidence_ready', 'validating', 'validators_missing', 'validators_ready']) {
      const verify = renderCard(progressAt(stage))
      expect(verify.textContent).toContain('验证 · Verify')
      expect(verify.textContent).not.toContain('构建 · Build')
      expect(verify.getAttribute('data-card-type')).toBe('progress')
      cleanup()
    }
  })
})

describe('LoopCard — agent strip: who is working (cockpit-card-agents)', () => {
  function strip(root: HTMLElement): HTMLElement {
    const el = root.querySelector('[data-testid="cockpit-card-agents"]') as HTMLElement
    expect(el).toBeTruthy()
    return el
  }

  it('every card lists the four-agent team (Claude/Codex/Gemini/GitHub)', () => {
    const cards: ApiLoopCard[] = [understanding(), plan(), progress(), blocker(), prReady(false)]
    for (const card of cards) {
      const el = strip(renderCard(card))
      for (const name of ['Claude', 'Codex', 'Gemini', 'GitHub']) expect(el.textContent).toContain(name)
      cleanup()
    }
  })

  it('highlights the active agent per card type and machine stage', () => {
    expect(strip(renderCard(understanding())).getAttribute('data-active-agent')).toBe('claude')
    cleanup()
    expect(strip(renderCard(plan())).getAttribute('data-active-agent')).toBe('claude')
    cleanup()
    expect(strip(renderCard(progressAt('running'))).getAttribute('data-active-agent')).toBe('codex')
    cleanup()
    expect(strip(renderCard(progressAt('validating'))).getAttribute('data-active-agent')).toBe('gemini')
    cleanup()
    expect(strip(renderCard(prReady(true))).getAttribute('data-active-agent')).toBe('github')
  })

  it('blocker: falls back to the last activity phase for the active agent', () => {
    const { container } = render(<LoopCard card={blocker()} lastActivityPhase="executing" />)
    const el = container.querySelector('[data-testid="cockpit-card-agents"]') as HTMLElement
    expect(el.getAttribute('data-active-agent')).toBe('codex')
  })
})

describe('LoopCard — next-step action button ON the card (cockpit-card-action)', () => {
  const action = { id: 'approve-roadmap', label: 'Approve Roadmap · 批准路线' }

  it('renders the primary action as the card action button and forwards clicks', () => {
    const onAction = vi.fn()
    const { container } = render(<LoopCard card={plan()} action={action} onAction={onAction} />)
    const btn = container.querySelector('[data-testid="cockpit-card-action"]') as HTMLButtonElement
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain('Approve Roadmap')
    expect(btn.getAttribute('data-action-id')).toBe('approve-roadmap')
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalledWith(action)
  })

  it('renders no card action button without a primary action', () => {
    const { container } = render(<LoopCard card={plan()} />)
    expect(container.querySelector('[data-testid="cockpit-card-action"]')).toBeNull()
  })

  it('disables the card action while busy', () => {
    const { container } = render(<LoopCard card={plan()} action={action} onAction={() => undefined} busy />)
    expect((container.querySelector('[data-testid="cockpit-card-action"]') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('LoopCard — blocker recovery actions: list with the recommended one emphasized', () => {
  it('marks the recommended recovery action', () => {
    const root = renderCard(blocker())
    const list = root.querySelector('[data-testid="cockpit-card-recovery"]') as HTMLElement
    expect(list).toBeTruthy()
    const items = Array.from(list.querySelectorAll('li'))
    expect(items.length).toBe(2)
    expect(items[0]?.getAttribute('data-recommended')).toBe('true')
    expect(items[0]?.querySelector('strong')).toBeTruthy()
    expect(items[1]?.getAttribute('data-recommended')).toBe('false')
    expect(items[1]?.querySelector('strong')).toBeNull()
  })
})

describe('LoopCard — evidence entries (cockpit-card-evidence)', () => {
  it('progress: evidence links render as clickable-looking entries', () => {
    const root = renderCard(progress())
    const entries = root.querySelectorAll('[data-testid="cockpit-card-evidence"]')
    expect(entries.length).toBe(1)
    expect(entries[0]?.textContent).toContain('evidence/run-1/gate.json')
  })

  it('pr_ready: changed files render as evidence entries', () => {
    const root = renderCard(prReady(false))
    const entries = root.querySelectorAll('[data-testid="cockpit-card-evidence"]')
    expect(entries.length).toBe(1)
    expect(entries[0]?.textContent).toContain('src/a.ts')
  })
})

describe('LoopCard — PR gate transparency: why / who / next, never raw codes', () => {
  it('blocker via the Gemini gate shows the three lines and credits Gemini', () => {
    const root = renderCard(gateBlocker('GEMINI_NOT_PASS'))
    const gate = root.querySelector('[data-testid="cockpit-card-pr-gate"]') as HTMLElement
    expect(gate).toBeTruthy()
    expect(gate.textContent).toContain('为什么')
    expect(gate.textContent).toContain('谁说的')
    expect(gate.textContent).toContain('下一步')
    expect(gate.textContent).toContain('Gemini')
    expect(gate.textContent).toContain('For safety the draft PR cannot be opened yet')
    expect(root.textContent).not.toContain('GEMINI_NOT_PASS')
  })

  it('blocker via the policy gate credits the safety gate (安全门), never the raw code', () => {
    const root = renderCard(gateBlocker('REMOTE_WRITES_DISABLED'))
    const gate = root.querySelector('[data-testid="cockpit-card-pr-gate"]') as HTMLElement
    expect(gate.textContent).toContain('安全门')
    expect(root.textContent).not.toContain('REMOTE_WRITES_DISABLED')
  })

  it('a HOLD blocker does not pretend to be a PR-gate decision', () => {
    const root = renderCard(blocker()) // hold_code present → the hold, not the gate, blocks
    expect(root.querySelector('[data-testid="cockpit-card-pr-gate"]')).toBeNull()
  })

  it('pr_ready with a checked gate explains why it can open, who said so and what is next', () => {
    const { container } = render(
      <LoopCard card={prReady(true)} prGate={{ status: 'created', reason: 'Draft PR URL is recorded on the mission.' }} />,
    )
    const gate = container.querySelector('[data-testid="cockpit-card-pr-gate"]') as HTMLElement
    expect(gate).toBeTruthy()
    expect(gate.textContent).toContain('为什么')
    expect(gate.textContent).toContain('谁说的')
    expect(gate.textContent).toContain('下一步')
    expect(gate.textContent).toContain('Draft PR URL is recorded')
  })

  it('pr_ready without any gate info renders no gate section', () => {
    const root = renderCard(prReady(false))
    expect(root.querySelector('[data-testid="cockpit-card-pr-gate"]')).toBeNull()
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

// ---- cloudhull-c5 — multi-user: non-owner viewers see "waiting for owner" ----
// Plan + PrReady are the two owner-gated decision cards; a viewer whose stored
// display name is not the owner sees calm bilingual waiting text instead of a
// dead-end (raw 403s never render — mapErrorToHuman covers the action path).

describe('LoopCard — non-owner viewers (cloudhull-c5)', () => {
  it('plan card shows 等待 Owner · waiting for owner when the viewer is not the owner', () => {
    const { container } = render(<LoopCard card={plan()} viewerIsOwner={false} />)
    const waiting = container.querySelector('[data-testid="cockpit-waiting-for-owner"]') as HTMLElement
    expect(waiting).toBeTruthy()
    expect(waiting.textContent).toContain('等待 Owner · waiting for owner')
    // next_step plain-language invariant kept
    const next = container.querySelector('[data-testid="cockpit-loop-card-next-step"]') as HTMLElement
    expect(next.textContent).toContain(plan().next_step)
    expect(container.textContent).not.toMatch(/403|OWNER_REQUIRED/)
  })

  it('pr_ready card shows the waiting-for-owner note for non-owner viewers', () => {
    const { container } = render(<LoopCard card={prReady(false)} viewerIsOwner={false} />)
    const waiting = container.querySelector('[data-testid="cockpit-waiting-for-owner"]') as HTMLElement
    expect(waiting).toBeTruthy()
    expect(waiting.textContent).toContain('等待 Owner · waiting for owner')
  })

  it('owner viewers (and the default) never see the waiting-for-owner note', () => {
    for (const el of [
      <LoopCard key="a" card={plan()} viewerIsOwner={true} />,
      <LoopCard key="b" card={plan()} />,
      <LoopCard key="c" card={progress()} viewerIsOwner={false} />,
      <LoopCard key="d" card={understanding()} viewerIsOwner={false} />,
    ]) {
      const { container } = render(el)
      expect(container.querySelector('[data-testid="cockpit-waiting-for-owner"]')).toBeNull()
      cleanup()
    }
  })
})
