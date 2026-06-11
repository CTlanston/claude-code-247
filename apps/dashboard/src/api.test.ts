import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, DAEMON } from './api.js'

beforeEach(() => vi.restoreAllMocks())

const mockFetch = (data: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => data }))

describe('api', () => {
  it('getMissions returns missions array', async () => {
    mockFetch({ missions: [{ id: '1', title: 'T', status: 'draft', createdAt: '' }] })
    const ms = await api.getMissions()
    expect(ms).toHaveLength(1)
    expect(ms[0]!.title).toBe('T')
  })

  it('getMissions throws on HTTP error', async () => {
    mockFetch({}, false)
    await expect(api.getMissions()).rejects.toThrow('HTTP 503')
  })

  it('approveMission POSTs to correct URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await api.approveMission('mission-1')
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/missions/mission-1/approve`, expect.objectContaining({ method: 'POST' }))
  })

  it('cancelMission POSTs status cancelled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await api.cancelMission('m-1')
    const call = fetchMock.mock.calls[0]!
    expect(JSON.parse(call[1].body as string)).toEqual({ status: 'cancelled' })
  })

  it('creates operator sessions and starts cockpit execution through the daemon API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ session: { id: 's1' }, messages: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await api.createOperatorSession({ repoId: 'repo-1', title: 'T', prompt: 'Build it' })
    await api.getLatestOperatorSession()
    await api.getOperatorSession('s1')
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ repoId: 'repo-1', title: 'T', prompt: 'Build it' }),
    }))
    // GETs carry an options object so the trusted-local x-aedev-user header
    // can attach when a display name is stored (cloudhull-c5).
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions?latest=1`, expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1`, expect.any(Object))

    await api.generateRoadmap('s1')
    await api.approveRoadmap('s1')
    await api.startOperatorSession('s1')
    await api.pauseOperatorSession('s1')
    await api.resumeOperatorSession('s1')
    await api.createDraftPr('s1')
    await api.getRunLog('m1', 'r1')
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1/generate-roadmap`, expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1/approve-roadmap`, expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1/start`, expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1/pause`, expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1/resume`, expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1/create-pr`, expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/missions/m1/runs/r1/log`, expect.any(Object))
  })

  it('sends the trusted-local x-aedev-user header when a display name is stored (cloudhull-c5)', async () => {
    vi.stubGlobal('localStorage', { getItem: () => ' Alice ', setItem: vi.fn(), removeItem: vi.fn() })
    try {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ session: { id: 's1' }, messages: [] }) })
      vi.stubGlobal('fetch', fetchMock)
      await api.getOperatorSession('s1')
      await api.startOperatorSession('s1')
      expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1`, expect.objectContaining({
        headers: expect.objectContaining({ 'x-aedev-user': 'Alice' }),
      }))
      expect(fetchMock).toHaveBeenCalledWith(`${DAEMON}/operator/sessions/s1/start`, expect.objectContaining({
        headers: expect.objectContaining({ 'x-aedev-user': 'Alice' }),
      }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('loads mission overview for cockpit observability', async () => {
    mockFetch({ mission: { id: 'm1' }, stage: 'Worker', stages: [], tasks: [], runs: [], validators: [], artifacts: [], cost: {} })
    const overview = await api.getMissionOverview('m1')
    expect(overview.stage).toBe('Worker')
  })
})
