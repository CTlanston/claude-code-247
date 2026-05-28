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
    })

    expect(sessions.map((session) => session.provider)).toEqual(['claude-cli'])
  })
})
