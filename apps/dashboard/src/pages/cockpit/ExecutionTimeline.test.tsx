// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ExecutionTimeline } from './ExecutionTimeline.js'

afterEach(cleanup)
import type { ApiMissionOverview } from '../../api.js'

function overview(partial: Partial<ApiMissionOverview>): ApiMissionOverview {
  return {
    mission: { id: 'm', title: 'M', status: 'running', createdAt: '' },
    stage: 'Worker', stages: [{ stage: 'Worker', status: 'active' }],
    tasks: [], runs: [], validators: [], artifacts: [], approvals: [],
    activeAgents: [], cliProvider: 'codex-cli', progress: 0.5, holds: [], events: [],
    cost: { mode: '', runCount: 0, validatorCount: 0, inputTokens: null, outputTokens: null, costUsd: null, note: '' },
    ...partial,
  } as ApiMissionOverview
}

describe('ExecutionTimeline', () => {
  it('shows a stalled banner with a wired Stop control when runProgress.stalled', () => {
    const onStop = vi.fn()
    render(<ExecutionTimeline busy={null} onPause={vi.fn()} onStop={onStop} onDiagnose={vi.fn()}
      overview={overview({ runProgress: { runId: 'r', status: 'running', exitCode: null, startedAt: '', lastHeartbeatAt: '', elapsedMs: 120_000, sinceHeartbeatMs: 120_000, stalled: true, lastProgressLabel: 'Worker output' } })} />)
    expect(screen.getByText(/Possibly stalled/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Stop/))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('shows a completion summary + next action on a terminal (failed) mission', () => {
    render(<ExecutionTimeline busy={null} onPause={vi.fn()} onStop={vi.fn()} onDiagnose={vi.fn()}
      overview={overview({
        mission: { id: 'm', title: 'M', status: 'failed', createdAt: '' },
        stage: 'PR/Waiting/Blocked',
        runs: [{ id: 'r', taskId: 't', runnerMode: 'codex-cli', status: 'failed', exitCode: 124 }],
        runProgress: { runId: 'r', status: 'failed', exitCode: 124, startedAt: '', lastHeartbeatAt: '', elapsedMs: 1000, sinceHeartbeatMs: 1000, stalled: false, lastProgressLabel: 'Worker failed' },
      })} />)
    expect(screen.getByText(/Summary/)).toBeTruthy()
    expect(screen.getByText(/Start Over/)).toBeTruthy()
    expect(screen.queryByText(/Possibly stalled/)).toBeNull()
  })
})
