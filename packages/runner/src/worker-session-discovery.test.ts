import { describe, expect, it } from 'vitest'
import { discoverWorkerSessions } from './worker-session-discovery.js'

describe('discoverWorkerSessions', () => {
  it('discovers CLI and API-backed sessions from runtime availability', async () => {
    const sessions = await discoverWorkerSessions({
      env: {
        OPENAI_API_KEY: 'openai-key',
        GEMINI_API_KEY: 'gemini-key',
      },
      now: () => '2026-05-28T00:00:00.000Z',
      commandAvailable: async (command) => command === 'codex',
    })

    expect(sessions.map((session) => [session.provider, session.healthy])).toEqual([
      ['claude-cli', false],
      ['codex-cli', true],
      ['gemini-api', true],
      ['openai-api', true],
    ])
    expect(sessions.map((session) => session.lastHeartbeatAt)).toEqual([
      '2026-05-28T00:00:00.000Z',
      '2026-05-28T00:00:00.000Z',
      '2026-05-28T00:00:00.000Z',
      '2026-05-28T00:00:00.000Z',
    ])
    expect(sessions[0]?.failureReason).toContain('claude is not available')
  })

  it('records heartbeat failures without dropping the session', async () => {
    const sessions = await discoverWorkerSessions({
      env: {},
      now: () => '2026-05-28T00:00:00.000Z',
      commandProbe: async (provider) => provider === 'codex-cli'
        ? { healthy: true }
        : { healthy: false, failureReason: 'session expired' },
    })

    expect(sessions.map((session) => [session.provider, session.healthy, session.failureReason ?? null])).toEqual([
      ['claude-cli', false, 'session expired'],
      ['codex-cli', true, null],
    ])
  })

  it('honors explicit provider disable flags', async () => {
    const sessions = await discoverWorkerSessions({
      env: {
        AEDEV_DISABLE_CODEX_CLI: '1',
        AEDEV_DISABLE_OPENAI_API: 'true',
        OPENAI_API_KEY: 'openai-key',
      },
      commandAvailable: async () => true,
    })

    expect(sessions.map((session) => session.provider)).toEqual(['claude-cli'])
  })

  it('does not invent API sessions when keys are absent', async () => {
    const sessions = await discoverWorkerSessions({
      env: {
        AEDEV_DISABLE_CLAUDE_CLI: '1',
        AEDEV_DISABLE_CODEX_CLI: '1',
      },
      commandAvailable: async () => true,
    })

    expect(sessions.map((session) => session.provider)).toEqual([])
  })
})
