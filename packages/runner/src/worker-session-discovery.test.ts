import { describe, expect, it } from 'vitest'
import { discoverWorkerSessions } from './worker-session-discovery.js'

describe('discoverWorkerSessions', () => {
  it('discovers CLI and API-backed sessions from runtime availability', async () => {
    const sessions = await discoverWorkerSessions({
      env: {
        OPENAI_API_KEY: 'openai-key',
        GEMINI_API_KEY: 'gemini-key',
      },
      commandAvailable: async (command) => command === 'codex',
      probeSessions: false,
    })

    expect(sessions.map((session) => session.provider)).toEqual([
      'codex-cli',
      'gemini-api',
      'openai-api',
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
      probeSessions: false,
    })

    expect(sessions.map((session) => session.provider)).toEqual(['claude-cli'])
  })

  it('marks a present-but-broken CLI unhealthy after probe failure', async () => {
    const sessions = await discoverWorkerSessions({
      env: { AEDEV_DISABLE_CLAUDE_CLI: '1' },
      commandAvailable: async (command) => command === 'codex',
      runProbe: async () => ({ ok: false, error: 'auth expired' }),
    })

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      provider: 'codex-cli',
      healthy: false,
      probeStatus: 'failed',
      probeError: 'auth expired',
    })
  })
})
