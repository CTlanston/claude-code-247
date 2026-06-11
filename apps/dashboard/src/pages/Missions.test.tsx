// @vitest-environment jsdom
// cloudhull-c5 — the Missions page groups operator sessions by the submitting
// user's display name (trusted-local multi-user; one shared Mac). The name is
// visible per group; no raw codes ever render.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const apiMock = vi.hoisted(() => ({
  getMissions: vi.fn(),
  listOperatorSessions: vi.fn(),
}))
vi.mock('../api.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api.js')>()), api: apiMock }))

import { MissionsPage } from './Missions.js'

afterEach(cleanup)
beforeEach(() => {
  apiMock.getMissions.mockResolvedValue([])
  apiMock.listOperatorSessions.mockResolvedValue([])
})

const session = (id: string, title: string, submittedBy?: string) => ({
  id, title, prompt: 'p', status: 'brainstorming', createdAt: '2026-06-11', updatedAt: '2026-06-11',
  ...(submittedBy ? { submittedBy } : {}),
})

describe('MissionsPage · sessions grouped by submittedBy (cloudhull-c5)', () => {
  it('groups sessions by display name with the name visible', async () => {
    apiMock.listOperatorSessions.mockResolvedValue([
      session('s1', 'Fix onboarding copy', 'Alice'),
      session('s2', 'Add parser test', 'Bob'),
      session('s3', 'Calmer empty state', 'Alice'),
    ])
    render(<MissionsPage />)
    const groups = await screen.findAllByTestId('missions-session-group')
    expect(groups).toHaveLength(2)
    const byName = Object.fromEntries(groups.map((g) => [g.getAttribute('data-submitted-by'), g]))
    expect(byName['Alice']?.textContent).toContain('Alice')
    expect(byName['Alice']?.textContent).toContain('Fix onboarding copy')
    expect(byName['Alice']?.textContent).toContain('Calmer empty state')
    expect(byName['Bob']?.textContent).toContain('Add parser test')
  })

  it('sessions without a recorded name fall into the owner group', async () => {
    apiMock.listOperatorSessions.mockResolvedValue([session('s1', 'Legacy session')])
    render(<MissionsPage />)
    const groups = await screen.findAllByTestId('missions-session-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.getAttribute('data-submitted-by')).toBe('owner')
    expect(groups[0]!.textContent).toContain('owner')
    expect(groups[0]!.textContent).toContain('Legacy session')
  })

  it('keeps the missions empty-state and never renders raw codes', async () => {
    apiMock.listOperatorSessions.mockResolvedValue([session('s1', 'T', 'Alice')])
    render(<MissionsPage />)
    await screen.findAllByTestId('missions-session-group')
    expect(screen.getByText(/No missions yet/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\b403\b|OWNER_REQUIRED|HOLD-[A-Z]/)
  })
})
