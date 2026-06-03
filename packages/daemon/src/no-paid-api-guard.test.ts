import { describe, expect, it } from 'vitest'
import { buildPlannerCoderEnv, paidApiKeysPresent } from './no-paid-api-guard.js'

describe('no paid API guard', () => {
  it('strips paid API keys from planner/coder child process env while preserving Gemini validator key', () => {
    const env = buildPlannerCoderEnv({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'anthropic-paid',
      ANTHROPIC_BASE_URL: 'https://anthropic.example',
      OPENAI_API_KEY: 'openai-paid',
      AEDEV_OPENAI_API_KEY: 'openai-validator-paid',
      AEDEV_GEMINI_API_KEY: 'gemini-validator',
      GEMINI_API_KEY: 'gemini-alias',
    })

    expect(paidApiKeysPresent(env)).toEqual([])
    expect(env['PATH']).toBe('/bin')
    expect(env['AEDEV_GEMINI_API_KEY']).toBe('gemini-validator')
    expect(env['GEMINI_API_KEY']).toBe('gemini-alias')
  })
})
