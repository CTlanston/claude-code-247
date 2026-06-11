// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const apiMock = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    getRepos: vi.fn(), listOperatorSessions: vi.fn(), getApprovals: vi.fn(), getLatestOperatorSession: vi.fn(), getStatus: vi.fn(),
    getOperatorSession: fn(), getMissionOverview: fn(), getRunLog: fn(), createOperatorSession: fn(),
    generateRoadmap: fn(), askQuestions: fn(), approveRoadmap: fn(), startOperatorSession: fn(),
    pauseOperatorSession: fn(), resumeOperatorSession: fn(), stopOperatorSession: fn(), createDraftPr: fn(),
    addOperatorMessage: fn(), answerQuestions: fn(),
  }
})
const sseMock = vi.hoisted(() => ({ value: { connected: true, missions: [], tasks: [], pendingApprovals: 0, events: [] } }))

vi.mock('../api.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api.js')>()), api: apiMock }))
vi.mock('../hooks/useSSE.js', () => ({ useSSE: () => sseMock.value }))

import { CockpitPage, buildGuidance, draftPrBlockedHeading, mapErrorToHuman } from './Cockpit.js'
import { ApiError, USER_NAME_STORAGE_KEY, type ApiMissionOverview } from '../api.js'

afterEach(cleanup)
beforeEach(() => {
  // jsdom has no scrollIntoView (ChatThread auto-scrolls on mount).
  Element.prototype.scrollIntoView = vi.fn()
  apiMock.getRepos.mockResolvedValue([{ id: 'r1', name: 'demo', path: '/tmp/demo', enabled: true }])
  apiMock.listOperatorSessions.mockResolvedValue([])
  apiMock.getApprovals.mockResolvedValue([])
  apiMock.getLatestOperatorSession.mockResolvedValue({ session: null, messages: [] })
  apiMock.getStatus.mockResolvedValue({ status: 'running', ownerName: 'owner', missionOs: { autonomy: 'draft-pr-only', workerConcurrency: { min: 1, max: 5 } } })
  localStorage.clear()
})

describe('CockpitPage', () => {
  it('shows exactly one "Start Brainstorm" button (no duplicate CTA)', async () => {
    render(<CockpitPage />)
    await waitFor(() => expect(apiMock.getRepos).toHaveBeenCalled())
    const buttons = await screen.findAllByRole('button', { name: /Start Brainstorm/ })
    expect(buttons).toHaveLength(1)
  })

  it('the approvals counter navigates to the approvals tab', async () => {
    const onNavigate = vi.fn()
    render(<CockpitPage onNavigate={onNavigate} />)
    const counter = await screen.findByRole('button', { name: /approvals/ })
    fireEvent.click(counter)
    expect(onNavigate).toHaveBeenCalledWith('approvals')
  })

  it('shows the selected repo path in the composer (operator always sees the target repo)', async () => {
    render(<CockpitPage />)
    expect(await screen.findByText(/the worker runs in an isolated git worktree of this repo/)).toBeTruthy()
  })
})

// v-ux-1 — non-developer UX: raw HTTP codes / gate codes never reach the chat flow.
describe('mapErrorToHuman', () => {
  it('turns a CLARIFY_GATE_BLOCKED 409 body into assistant-style guidance (not an error)', () => {
    const e = new ApiError('HTTP 409: /operator/sessions/s1/generate-roadmap', 409, {
      humanState: 'needs_more_context',
      guidance: '还有几个问题需要你先确认 · Please answer the outstanding questions first.',
      blocked: { code: 'CLARIFY_GATE_BLOCKED' },
    })
    const h = mapErrorToHuman(e)
    expect(h.kind).toBe('guidance')
    expect(h.text).toContain('确认')
    expect(h.text).not.toMatch(/CLARIFY_GATE_BLOCKED|409/)
  })

  it('never renders raw CLARIFY_GATE_BLOCKED / 409 strings verbatim, even without a body', () => {
    const h = mapErrorToHuman(new Error('HTTP 409: CLARIFY_GATE_BLOCKED'))
    expect(h.kind).toBe('guidance')
    expect(h.text).not.toMatch(/CLARIFY_GATE_BLOCKED|409/)
  })

  it('maps unknown errors to a generic human message with the raw text only as detail', () => {
    const h = mapErrorToHuman(new Error('TypeError: boom at stack trace line 42'))
    expect(h.kind).toBe('error')
    expect(h.text).toContain('系统遇到问题，正在保护现场')
    expect(h.text).toContain('Something needs attention')
    expect(h.detail).toContain('boom')
  })

  it('keeps the friendly daemon-down message for network failures', () => {
    const h = mapErrorToHuman(new Error('Failed to fetch'))
    expect(h.kind).toBe('error')
    expect(h.text).toMatch(/cockpit:dev/)
  })
})

function makeOverview(): ApiMissionOverview {
  return {
    mission: { id: 'm1', title: 'M', status: 'approved', createdAt: '2026-01-01' },
    stage: 'Approved',
    stages: [],
    operatorView: {
      stage: 'approved',
      stageLabel: 'Ready to execute · 可启动执行',
      confidence: 96,
      progressPercent: 50,
      secondaryActions: [],
      providerSummary: { planner: { name: 'claude', mode: 'subscription-local' }, validators: [] },
      safetySummary: { remoteWrites: 'disabled' },
      understanding: { roundsCompleted: 1, questions: [] },
      projectPulse: { progress: [], touchedFiles: [], evidence: [], validatorReviews: [] },
      memorySummary: { projectFacts: [], userPreferences: [], recentLessons: [] },
      summary: 'ready',
      nextAction: 'start',
      testMode: false,
      userState: { state: 'ready_to_execute', label: 'Ready to start', labelZh: '可以开始执行', explanation: '方案已批准，点击开始后才会动手。' },
      lastActivity: { atIso: new Date().toISOString(), agoMs: 1000, phase: 'planning' },
      loopSummary: { whatChanged: ['src/a.ts'], testsRan: ['gate.json'], agents: ['planner · claude'], validatorSaid: null, whyStoppedOrContinuing: '等待你的确认' },
    },
    tasks: [], runs: [], validators: [], artifacts: [], approvals: [],
    activeAgents: [], cliProvider: 'mock', progress: 0.5, holds: [], events: [],
    cost: { mode: 'subscription_mode_usage', runCount: 0, validatorCount: 0, inputTokens: null, outputTokens: null, costUsd: null, note: '' },
  }
}

describe('CockpitPage · progress + loop visibility (v-ux-1)', () => {
  it('renders last-activity and the loop summary once a mission overview exists', async () => {
    apiMock.getLatestOperatorSession.mockResolvedValue({
      session: { id: 's1', missionId: 'm1', title: 'M', prompt: 'p', status: 'approved', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      messages: [],
    })
    apiMock.getMissionOverview.mockResolvedValue(makeOverview())
    render(<CockpitPage />)
    await waitFor(() => expect(apiMock.getMissionOverview).toHaveBeenCalled())
    expect(await screen.findByTestId('cockpit-last-activity')).toBeTruthy()
    expect(screen.getByTestId('cockpit-last-activity').textContent).toMatch(/ago/)
    expect(screen.getByTestId('cockpit-loop-summary').textContent).toContain('src/a.ts')
    // The Now cell shows a live elapsed counter while planner/worker is in flight.
    expect(screen.getByTestId('cockpit-now-elapsed')).toBeTruthy()
  })
})

// ux-2 follow-up — the gate card heading is human-first: the raw machine code
// never shows in visible text; tooling reads it from data-pr-gate-code only.
describe('Draft PR gate card · GEMINI_NOT_CONFIGURED is humanized', () => {
  it('draftPrBlockedHeading maps GEMINI_NOT_CONFIGURED to calm bilingual phrasing', () => {
    const h = draftPrBlockedHeading('GEMINI_NOT_CONFIGURED')
    expect(h).toContain('结果评审尚未配置')
    expect(h).toContain('result review not configured')
    expect(h).not.toContain('GEMINI_NOT_CONFIGURED')
    // unknown codes keep their existing literal rendering
    expect(draftPrBlockedHeading('SOME_OTHER_CODE')).toContain('SOME_OTHER_CODE')
    expect(draftPrBlockedHeading(undefined)).toBe('Draft PR blocked · 被安全门拦截')
  })

  it('renders the blocked card without the raw code in visible text, keeping it in data-pr-gate-code', async () => {
    apiMock.getLatestOperatorSession.mockResolvedValue({
      session: { id: 's1', missionId: 'm1', title: 'M', prompt: 'p', status: 'waiting', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      messages: [],
    })
    // mission at the evidence gate so the guidance keeps the Check Draft PR Gate CTA
    const atGate = makeOverview()
    atGate.mission.status = 'done'
    apiMock.getMissionOverview.mockResolvedValue(atGate)
    apiMock.createDraftPr.mockResolvedValue({
      status: 'blocked',
      code: 'GEMINI_NOT_CONFIGURED',
      reason: 'Gemini validation has not produced a verdict for this mission.',
      overview: atGate,
    })
    render(<CockpitPage />)
    fireEvent.click(await screen.findByTestId('cockpit-check-draft-pr-gate'))
    const card = await screen.findByTestId('cockpit-pr-gate-card')
    expect(card.getAttribute('data-pr-gate-status')).toBe('blocked')
    expect(card.getAttribute('data-pr-gate-code')).toBe('GEMINI_NOT_CONFIGURED')
    expect(card.textContent).not.toContain('GEMINI_NOT_CONFIGURED')
    expect(card.textContent).toContain('结果评审尚未配置')
    expect(card.textContent).toContain('result review not configured')
  })
})

// overnight-p3 — the loop card is an operator console: the daemon's
// primaryAction renders ON the card (cockpit-card-action) through the SAME
// handler plumbing as the guidance buttons, and the agent strip shows who is
// working — no logs needed.
describe('CockpitPage · loop card carries the primary action + agent strip (overnight-p3)', () => {
  it('renders primaryAction on the card and clicking it calls the existing handler', async () => {
    const session = { id: 's1', missionId: 'm1', title: 'M', prompt: 'p', status: 'approved', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
    apiMock.getLatestOperatorSession.mockResolvedValue({ session, messages: [] })
    const overview = makeOverview()
    overview.operatorView!.primaryAction = { id: 'start-execution', label: 'Start Execution · 启动执行', kind: 'primary' }
    overview.operatorView!.card = {
      type: 'progress',
      title: '可以开始执行 · Ready to start',
      next_step: '点击启动执行后才会动手 · Work starts when you click start.',
      machine: { user_state: 'ready_to_execute', stage: 'approved', hold_code: null, pr_gate_code: null },
      current_phase: '可以开始执行 · Ready to start',
      current_action: '等待启动 · Waiting for your start.',
      evidence_links: [],
      tests_run: [],
    }
    apiMock.getMissionOverview.mockResolvedValue(overview)
    apiMock.startOperatorSession.mockResolvedValue({ session, overview })
    render(<CockpitPage />)
    const btn = await screen.findByTestId('cockpit-card-action')
    expect(btn.textContent).toContain('Start Execution')
    expect(btn.getAttribute('data-action-id')).toBe('start-execution')
    expect(screen.getByTestId('cockpit-card-agents')).toBeTruthy()
    fireEvent.click(btn)
    await waitFor(() => expect(apiMock.startOperatorSession).toHaveBeenCalledWith('s1'))
  })
})

// cloudhull-c5 — multi-user prototype: the composer carries a display-name
// input (persisted in localStorage, sent as submittedBy), owner-gate 403s map
// to calm guidance, and non-owner viewers see the waiting-for-owner note.
describe('CockpitPage · display name input (cloudhull-c5)', () => {
  it('renders the name input, persists it to localStorage, and sends submittedBy on brainstorm', async () => {
    apiMock.createOperatorSession.mockResolvedValue({
      session: { id: 's9', title: 'T', prompt: 'p', status: 'brainstorming', createdAt: '2026-01-01', updatedAt: '2026-01-01', submittedBy: 'Bob' },
      messages: [],
    })
    render(<CockpitPage />)
    const input = await screen.findByTestId('cockpit-user-name-input')
    fireEvent.change(input, { target: { value: 'Bob' } })
    expect(localStorage.getItem(USER_NAME_STORAGE_KEY)).toBe('Bob')
    fireEvent.click(await screen.findByTestId('cockpit-start-brainstorm'))
    await waitFor(() => expect(apiMock.createOperatorSession).toHaveBeenCalled())
    expect(apiMock.createOperatorSession.mock.calls[0]![0]).toMatchObject({ submittedBy: 'Bob' })
  })

  it('restores the stored name on mount', async () => {
    localStorage.setItem(USER_NAME_STORAGE_KEY, 'Carol')
    render(<CockpitPage />)
    const input = await screen.findByTestId('cockpit-user-name-input')
    expect((input as HTMLInputElement).value).toBe('Carol')
  })
})

describe('CockpitPage · non-owner viewers wait for the owner (cloudhull-c5)', () => {
  it('shows 等待 Owner on the plan card when the stored name is not the owner; no raw codes', async () => {
    localStorage.setItem(USER_NAME_STORAGE_KEY, 'Bob')
    apiMock.getStatus.mockResolvedValue({ status: 'running', ownerName: 'lan', missionOs: { autonomy: 'draft-pr-only', workerConcurrency: { min: 1, max: 5 } } })
    apiMock.getLatestOperatorSession.mockResolvedValue({
      session: { id: 's1', missionId: 'm1', title: 'M', prompt: 'p', status: 'roadmap_ready', createdAt: '2026-01-01', updatedAt: '2026-01-01', submittedBy: 'Bob' },
      messages: [],
    })
    const overview = makeOverview()
    overview.operatorView!.card = {
      type: 'plan',
      title: '等待你的确认 · Waiting for your go-ahead',
      next_step: '审阅这份方案；你批准后才会开始动手 · Review this plan; work starts only after you approve it.',
      machine: { user_state: 'waiting_for_approval', stage: 'roadmap_ready', hold_code: null, pr_gate_code: null },
      objective: 'obj', phases: [], acceptance_criteria: ['c1'], risk_level: 'low', estimated_calls: 15, requires_approval: true,
    }
    apiMock.getMissionOverview.mockResolvedValue(overview)
    render(<CockpitPage />)
    const waiting = await screen.findByTestId('cockpit-waiting-for-owner')
    expect(waiting.textContent).toContain('等待 Owner · waiting for owner')
    expect(document.body.textContent).not.toMatch(/\b403\b|OWNER_REQUIRED/)
  })

  it('owner viewers (matching stored name) never see the waiting note', async () => {
    localStorage.setItem(USER_NAME_STORAGE_KEY, 'lan')
    apiMock.getStatus.mockResolvedValue({ status: 'running', ownerName: 'lan', missionOs: { autonomy: 'draft-pr-only', workerConcurrency: { min: 1, max: 5 } } })
    apiMock.getLatestOperatorSession.mockResolvedValue({
      session: { id: 's1', missionId: 'm1', title: 'M', prompt: 'p', status: 'roadmap_ready', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      messages: [],
    })
    const overview = makeOverview()
    overview.operatorView!.card = {
      type: 'plan',
      title: '等待你的确认 · Waiting for your go-ahead',
      next_step: '审阅这份方案；你批准后才会开始动手 · Review this plan; work starts only after you approve it.',
      machine: { user_state: 'waiting_for_approval', stage: 'roadmap_ready', hold_code: null, pr_gate_code: null },
      objective: 'obj', phases: [], acceptance_criteria: ['c1'], risk_level: 'low', estimated_calls: 15, requires_approval: true,
    }
    apiMock.getMissionOverview.mockResolvedValue(overview)
    render(<CockpitPage />)
    await screen.findByTestId('cockpit-loop-card')
    expect(screen.queryByTestId('cockpit-waiting-for-owner')).toBeNull()
  })
})

describe('mapErrorToHuman · owner-gate 403 (cloudhull-c5)', () => {
  it('turns an owner-gate 403 body into calm guidance, never the raw status', () => {
    const e = new ApiError('HTTP 403: /operator/sessions/s1/approve-roadmap', 403, {
      humanState: 'waiting_for_approval',
      guidance: '这一步需要 Owner 执行 · this step belongs to the owner.',
      ownerName: 'owner',
    })
    const h = mapErrorToHuman(e)
    expect(h.kind).toBe('guidance')
    expect(h.text).toContain('这一步需要 Owner 执行')
    expect(h.text).not.toMatch(/403/)
  })

  it('falls back to calm owner guidance even without a structured body', () => {
    const h = mapErrorToHuman(new Error('HTTP 403: /operator/sessions/s1/start'))
    expect(h.kind).toBe('guidance')
    expect(h.text).toMatch(/Owner/i)
    expect(h.text).not.toMatch(/403/)
  })
})

describe('buildGuidance · inline decision flow (#2: no Approve/Start after Generate)', () => {
  const base = {
    overview: null,
    busy: null,
    messages: [],
    latestHold: null,
    sseConnected: true,
    onBrainstorm: vi.fn(), onRoadmap: vi.fn(), onApprove: vi.fn(), onStart: vi.fn(),
    onPause: vi.fn(), onResume: vi.fn(), onDraftPr: vi.fn(), onReset: vi.fn(), onStop: vi.fn(),
  }
  const session = (status: string) => ({
    id: 's1', title: 't', prompt: 'p', status, missionId: 'm1',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  })

  // Before the fix, these branches keyed off the async/nullable overview, so right
  // after Generate (overview still null) the card showed no button at all.
  it('shows inline Approve right after Generate, even when overview has not loaded', () => {
    const g = buildGuidance({ ...base, session: session('roadmap_ready') })
    expect(g.primary?.label).toMatch(/Approve/)
  })

  it('shows inline Start once approved, even when overview has not loaded', () => {
    const g = buildGuidance({ ...base, session: session('approved') })
    expect(g.primary?.label).toMatch(/Start Execution/)
  })
})
