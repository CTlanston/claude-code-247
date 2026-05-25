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
})
