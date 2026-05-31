// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ApiApproval } from '../api.js'

const { getApprovals, decideApproval } = vi.hoisted(() => ({ getApprovals: vi.fn(), decideApproval: vi.fn() }))
vi.mock('../api.js', () => ({ api: { getApprovals, decideApproval } }))

import { ApprovalsPage } from './Approvals.js'

afterEach(cleanup)
beforeEach(() => {
  getApprovals.mockReset()
  decideApproval.mockReset()
  localStorage.clear()
})

function pending(): ApiApproval {
  return {
    id: 'a1', entityType: 'mission', entityId: 'm1', requiredReason: 'Roadmap approval required',
    status: 'pending', createdAt: new Date().toISOString(), ageMs: 5000,
    mission: { id: 'm1', title: 'Docs mission', status: 'pending_approval', repoId: 'r1' },
    repo: { id: 'r1', name: 'my-repo', path: '/tmp/my-repo', enabled: true },
    sessionId: 's1',
  }
}

describe('ApprovalsPage workbench', () => {
  it('renders an enriched, actionable card (mission title, repo, actions)', async () => {
    getApprovals.mockResolvedValue([pending()])
    render(<ApprovalsPage />)
    expect(await screen.findByText('Docs mission')).toBeTruthy()
    expect(screen.getByText('my-repo')).toBeTruthy()
    expect(screen.getByText(/Roadmap approval required/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Approve/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reject/ })).toBeTruthy()
  })

  it('approve triggers decideApproval and refreshes', async () => {
    getApprovals.mockResolvedValueOnce([pending()]).mockResolvedValue([])
    decideApproval.mockResolvedValue({ status: 'ok', decision: 'approve', approvals: [] })
    render(<ApprovalsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith('a1', 'approve'))
  })

  it('"open in cockpit" stores the session and navigates', async () => {
    getApprovals.mockResolvedValue([pending()])
    const onNavigate = vi.fn()
    render(<ApprovalsPage onNavigate={onNavigate} />)
    fireEvent.click(await screen.findByRole('button', { name: /Open in cockpit/ }))
    expect(onNavigate).toHaveBeenCalledWith('cockpit')
    expect(localStorage.getItem('operatorCockpitSessionId')).toBe('s1')
  })
})
