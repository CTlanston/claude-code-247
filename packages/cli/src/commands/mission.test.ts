import { describe, it, expect, vi, afterEach } from 'vitest'
import { Command } from 'commander'
import { registerMissionCommand } from './mission.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mission command', () => {
  it('mission approve requests approval before approving the mission', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const program = new Command()
    program.exitOverride()
    registerMissionCommand(program)
    await program.parseAsync(['node', 'aedev', 'mission', 'approve', 'mission-1'])

    expect(calls).toEqual([
      'http://127.0.0.1:7247/missions/mission-1/request-approval',
      'http://127.0.0.1:7247/missions/mission-1/approve',
    ])
    expect(log).toHaveBeenCalledWith('Mission mission-1 approved')
  })

  it('mission run calls the daemon run endpoint', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ status: 'done', evidenceDir: '/tmp/evidence' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const program = new Command()
    program.exitOverride()
    registerMissionCommand(program)
    await program.parseAsync(['node', 'aedev', 'mission', 'run', 'mission-1'])

    expect(calls).toEqual(['http://127.0.0.1:7247/missions/mission-1/run'])
  })
})
