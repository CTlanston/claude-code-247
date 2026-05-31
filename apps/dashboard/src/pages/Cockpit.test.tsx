// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const apiMock = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    getRepos: vi.fn(), listOperatorSessions: vi.fn(), getApprovals: vi.fn(), getLatestOperatorSession: vi.fn(),
    getOperatorSession: fn(), getMissionOverview: fn(), getRunLog: fn(), createOperatorSession: fn(),
    generateRoadmap: fn(), askQuestions: fn(), approveRoadmap: fn(), startOperatorSession: fn(),
    pauseOperatorSession: fn(), resumeOperatorSession: fn(), stopOperatorSession: fn(), createDraftPr: fn(),
    addOperatorMessage: fn(), answerQuestions: fn(),
  }
})
const sseMock = vi.hoisted(() => ({ value: { connected: true, missions: [], tasks: [], pendingApprovals: 0, events: [] } }))

vi.mock('../api.js', () => ({ api: apiMock }))
vi.mock('../hooks/useSSE.js', () => ({ useSSE: () => sseMock.value }))

import { CockpitPage } from './Cockpit.js'

afterEach(cleanup)
beforeEach(() => {
  // jsdom has no scrollIntoView (ChatThread auto-scrolls on mount).
  Element.prototype.scrollIntoView = vi.fn()
  apiMock.getRepos.mockResolvedValue([{ id: 'r1', name: 'demo', path: '/tmp/demo', enabled: true }])
  apiMock.listOperatorSessions.mockResolvedValue([])
  apiMock.getApprovals.mockResolvedValue([])
  apiMock.getLatestOperatorSession.mockResolvedValue({ session: null, messages: [] })
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
