import { describe, expect, it } from 'vitest'
import type { SecretGrant } from '@aedev/core'
import {
  buildDefaultMissionValidators,
  createDefaultMissionValidatorFactory,
  inspectDefaultMissionValidatorSecrets,
} from './validator-factory.js'

const ctx = { missionId: 'mission-1', taskId: 'task-1' }

describe('default mission validator factory', () => {
  it('returns no validators when wrapper-injected secrets are absent', () => {
    expect(buildDefaultMissionValidators(ctx, { env: {} })).toEqual([])
    expect(inspectDefaultMissionValidatorSecrets(ctx, { env: {} })).toMatchObject({
      geminiConfigured: false,
      openaiConfigured: false,
      configuredCount: 0,
      missingProviders: ['gemini', 'openai'],
    })
  })

  it('builds Gemini + OpenAI validators from approved runtime secret env without live calls', async () => {
    const requests: string[] = []
    const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('generativelanguage.googleapis.com')) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'pass', summary: 'gemini ok' }) }] } }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ verdict: 'pass', summary: 'openai ok' }) } }],
      }), { status: 200 })
    }) as typeof fetch

    const validators = buildDefaultMissionValidators(ctx, {
      env: {
        GEMINI_API_KEY: 'gemini-secret-from-wrapper',
        OPENAI_API_KEY: 'openai-secret-from-wrapper',
      },
      fetchFn,
      geminiOptions: { model: 'gemini-test' },
      openaiOptions: { model: 'openai-test' },
    })

    expect(validators).toHaveLength(2)
    await expect(validators[0]!.validate(ctx.taskId, { 'done-report.md': 'done' })).resolves.toMatchObject({
      validator: 'gemini',
      verdict: 'pass',
    })
    await expect(validators[1]!.validate(ctx.taskId, { 'done-report.md': 'done' })).resolves.toMatchObject({
      validator: 'openai',
      verdict: 'pass',
    })
    expect(requests).toHaveLength(2)
  })

  it('requires active task-scoped grants when grant metadata is supplied', () => {
    const now = new Date('2026-05-29T23:30:00Z')
    const secretGrants: SecretGrant[] = [
      grant('AEDEV_GEMINI_API_KEY', 'task-1', 'active', '2026-05-30T00:00:00Z'),
      grant('AEDEV_OPENAI_API_KEY', 'task-1', 'revoked', '2026-05-30T00:00:00Z'),
      grant('OPENAI_API_KEY', 'other-task', 'active', '2026-05-30T00:00:00Z'),
    ]

    const validators = buildDefaultMissionValidators(ctx, {
      env: {
        AEDEV_GEMINI_API_KEY: 'gemini-granted',
        AEDEV_OPENAI_API_KEY: 'openai-revoked',
        OPENAI_API_KEY: 'openai-other-task',
      },
      secretGrants,
      now,
    })

    expect(validators).toHaveLength(1)
    expect(inspectDefaultMissionValidatorSecrets(ctx, {
      env: {
        AEDEV_GEMINI_API_KEY: 'gemini-granted',
        AEDEV_OPENAI_API_KEY: 'openai-revoked',
        OPENAI_API_KEY: 'openai-other-task',
      },
      secretGrants,
      now,
    })).toMatchObject({
      geminiConfigured: true,
      openaiConfigured: false,
      configuredCount: 1,
      missingProviders: ['openai'],
    })
  })

  it('allows a secrets-mcp resolver to supply both keys at task runtime', () => {
    const factory = createDefaultMissionValidatorFactory({
      env: {},
      secretResolver: ({ provider }) => `${provider}-resolved-by-wrapper`,
    })

    expect(factory(ctx)).toHaveLength(2)
  })
})

function grant(
  secretName: string,
  taskId: string,
  status: SecretGrant['status'],
  expiresAt: string,
): SecretGrant {
  return {
    id: `grant-${secretName}-${taskId}-${status}`,
    secretName,
    taskId,
    ttlSeconds: 3600,
    grantedBy: 'operator',
    grantedAt: '2026-05-29T23:00:00Z',
    expiresAt,
    reason: 'validator test',
    status,
  }
}
