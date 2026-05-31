// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ApiTask } from '../api.js'

const { getTasks } = vi.hoisted(() => ({ getTasks: vi.fn() }))
vi.mock('../api.js', () => ({ api: { getTasks } }))

import { TasksPage } from './Tasks.js'

afterEach(cleanup)
beforeEach(() => { getTasks.mockReset() })

function task(partial: Partial<ApiTask>): ApiTask {
  return { id: 't', title: 't', status: 'pending', missionId: 'm1', createdAt: new Date().toISOString(), ...partial }
}

describe('TasksPage live view', () => {
  it('shows the running task with mission title, repo, and run state', async () => {
    getTasks.mockResolvedValue([
      task({ id: 'tr', title: 'impl', status: 'running', missionTitle: 'Live mission', repoName: 'demo-repo', latestRun: { id: 'r', runnerMode: 'codex-cli', status: 'running', exitCode: null, evidenceDir: '/tmp/ev' } }),
    ])
    render(<TasksPage />)
    expect(await screen.findByText('Live mission')).toBeTruthy()
    expect(screen.getByText('demo-repo')).toBeTruthy()
    expect(screen.getByText(/run codex-cli:running/)).toBeTruthy()
    expect(screen.getByText(/evidence: \/tmp\/ev/)).toBeTruthy()
  })

  it('filters by search query', async () => {
    getTasks.mockResolvedValue([
      task({ id: 'a', title: 'alpha', missionTitle: 'Alpha mission' }),
      task({ id: 'b', title: 'beta', missionTitle: 'Beta mission' }),
    ])
    render(<TasksPage />)
    expect(await screen.findByText('Alpha mission')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'beta' } })
    expect(screen.queryByText('Alpha mission')).toBeNull()
    expect(screen.getByText('Beta mission')).toBeTruthy()
  })
})
