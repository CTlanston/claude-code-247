// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ApiFleetOverview } from '../api.js'

const { getFleetOverview } = vi.hoisted(() => ({ getFleetOverview: vi.fn() }))
vi.mock('../api.js', () => ({ api: { getFleetOverview } }))

import { FleetPage } from './Fleet.js'

afterEach(cleanup)
beforeEach(() => { getFleetOverview.mockReset() })

const overview: ApiFleetOverview = {
  workers: [
    { workerId: 'w-alice-1', operatorId: 'alice', status: 'active', lastSeenAt: '2026-06-10T08:00:00.000Z', claimedTaskIds: ['t-1'] },
    { workerId: 'w-bob-1', operatorId: 'bob', status: 'frozen', lastSeenAt: null, claimedTaskIds: [] },
  ],
  operators: [
    {
      operatorId: 'alice', headlessCallsToday: 2,
      activeHolds: [{
        code: 'HOLD-BUDGET', entityType: 'operator_session', entityId: 'fleet:alice',
        reason: 'Daily headless-call budget reached (2/2 today).', createdAt: '2026-06-10T08:00:00.000Z',
      }],
    },
    { operatorId: 'bob', headlessCallsToday: 0, activeHolds: [] },
  ],
}

describe('FleetPage — read-only squad view (v5-P3)', () => {
  it('lists workers with status plus per-operator call counts and holds', async () => {
    getFleetOverview.mockResolvedValue(overview)
    render(<FleetPage />)
    expect(await screen.findByText('w-alice-1')).toBeTruthy()
    expect(screen.getByText('w-bob-1')).toBeTruthy()
    expect(screen.getByText('frozen')).toBeTruthy()
    expect(screen.getByText(/2 calls today/)).toBeTruthy()
    expect(screen.getByText(/HOLD-BUDGET/)).toBeTruthy()
    expect(screen.getByText(/t-1/)).toBeTruthy()
  })

  it('renders NO buttons and no other write controls (member view is read-only)', async () => {
    getFleetOverview.mockResolvedValue(overview)
    const { container } = render(<FleetPage />)
    await screen.findByText('w-alice-1')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('input, select, textarea, form')).toHaveLength(0)
  })

  it('shows an empty state when no workers are registered', async () => {
    getFleetOverview.mockResolvedValue({ workers: [], operators: [] })
    render(<FleetPage />)
    expect(await screen.findByText(/No fleet workers/)).toBeTruthy()
  })
})
