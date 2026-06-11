// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ApiOpsOverview } from '../api.js'

const { getOpsOverview } = vi.hoisted(() => ({ getOpsOverview: vi.fn() }))
vi.mock('../api.js', () => ({ api: { getOpsOverview } }))

import { OpsPage } from './Ops.js'

afterEach(cleanup)
beforeEach(() => { getOpsOverview.mockReset() })

const CLAUDE_RECOVERY = 'Claude planner needs login on this Mac · 在这台 Mac 上运行 claude login'

const overview: ApiOpsOverview = {
  activeHolds: [{
    code: 'HOLD-PLANNER-AUTH', entityType: 'operator_session', entityId: 's-1',
    text: '本地 Claude 登录已过期或额度用尽：在终端运行 claude login 重新登录，或检查订阅额度 · The local Claude session needs re-login or has run out of credit — run "claude login" in a terminal, or check your subscription credit.',
    createdAt: '2026-06-11T08:00:00.000Z',
  }],
  activeMissions: [
    { id: 'm-1', title: 'Fix the importer', status: 'running', submittedBy: 'Alice' },
  ],
  lastValidator: { status: 'done', verdict: 'PASS', atIso: '2026-06-11T07:00:00.000Z' },
  remoteWrites: { enabled: false, whitelist: [] },
  engines: { claude: 'needs_login', codex: 'ready', gemini: 'not_configured' },
  suggestedRecovery: [CLAUDE_RECOVERY],
}

const emptyOverview: ApiOpsOverview = {
  activeHolds: [], activeMissions: [], lastValidator: null,
  remoteWrites: { enabled: false, whitelist: [] },
  engines: { claude: 'unknown', codex: 'unknown', gemini: 'not_configured' },
  suggestedRecovery: [],
}

describe('OpsPage — single owner Operations view (cloudhull-c6)', () => {
  it('renders every section with humanized text and emphasizes recovery', async () => {
    getOpsOverview.mockResolvedValue(overview)
    render(<OpsPage />)
    const page = await screen.findByTestId('ops-page')
    expect(page).toBeTruthy()
    const recovery = screen.getByTestId('ops-recovery')
    expect(recovery.textContent).toContain(CLAUDE_RECOVERY)
    // engines are humanized
    expect(screen.getByText(/Needs login/)).toBeTruthy()
    expect(screen.getByText(/Ready/)).toBeTruthy()
    // missions, validator and remote-writes sections render
    expect(screen.getByText('Fix the importer')).toBeTruthy()
    expect(screen.getByText(/Alice/)).toBeTruthy()
    expect(screen.getByText(/PASS/)).toBeTruthy()
    expect(screen.getByText(/nothing leaves this Mac/i)).toBeTruthy()
  })

  it('never shows raw machine codes as text — they live only in data-* attributes', async () => {
    getOpsOverview.mockResolvedValue(overview)
    const { container } = render(<OpsPage />)
    await screen.findByTestId('ops-page')
    expect(screen.queryByText(/HOLD-PLANNER-AUTH/)).toBeNull()
    expect(screen.queryByText(/needs_login/)).toBeNull()
    expect(screen.queryByText(/not_configured/)).toBeNull()
    expect(container.querySelector('[data-code="HOLD-PLANNER-AUTH"]')).toBeTruthy()
    expect(container.querySelector('[data-engine-status="needs_login"]')).toBeTruthy()
  })

  it('is strictly read-only: no buttons, inputs or forms', async () => {
    getOpsOverview.mockResolvedValue(overview)
    const { container } = render(<OpsPage />)
    await screen.findByTestId('ops-page')
    expect(container.querySelectorAll('button, input, select, textarea, form')).toHaveLength(0)
  })

  it('shows a calm empty state when nothing needs the owner', async () => {
    getOpsOverview.mockResolvedValue(emptyOverview)
    render(<OpsPage />)
    await screen.findByTestId('ops-page')
    const recovery = screen.getByTestId('ops-recovery')
    expect(recovery.textContent).toMatch(/Nothing needs your attention/i)
  })
})
