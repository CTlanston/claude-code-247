import type { SecretGrant } from '@aedev/core'
import { GeminiValidator, OpenAIValidator, type GeminiValidatorOptions, type OpenAIValidatorOptions } from '@aedev/validators'
import type { MissionValidator, MissionValidatorFactory } from './mission-runner.js'

export const GEMINI_SECRET_NAMES = ['AEDEV_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const
export const OPENAI_SECRET_NAMES = ['AEDEV_OPENAI_API_KEY', 'OPENAI_API_KEY'] as const

export type ValidatorSecretName =
  | typeof GEMINI_SECRET_NAMES[number]
  | typeof OPENAI_SECRET_NAMES[number]

export interface ValidatorFactoryContext {
  missionId: string
  taskId: string
}

export interface ValidatorSecretResolverContext extends ValidatorFactoryContext {
  provider: 'gemini' | 'openai'
  names: readonly ValidatorSecretName[]
}

export type ValidatorSecretResolver = (ctx: ValidatorSecretResolverContext) => string | undefined

export interface DefaultMissionValidatorFactoryOptions {
  /**
   * Env injected by the approved secrets wrapper. Tests pass a fake object.
   * Production intentionally resolves at run time so key values are never
   * committed or logged.
   */
  env?: Record<string, string | undefined>
  /** Optional active grants. When provided, a matching active task grant is required. */
  secretGrants?: SecretGrant[]
  /** Optional resolver for secrets-mcp / with-secrets integrations. */
  secretResolver?: ValidatorSecretResolver
  now?: Date
  fetchFn?: typeof fetch
  geminiOptions?: Omit<GeminiValidatorOptions, 'apiKey' | 'fetchFn'>
  openaiOptions?: Omit<OpenAIValidatorOptions, 'apiKey' | 'fetchFn'>
}

export interface DefaultValidatorSecretStatus {
  geminiConfigured: boolean
  openaiConfigured: boolean
  configuredCount: number
  missingProviders: Array<'gemini' | 'openai'>
}

export function createDefaultMissionValidatorFactory(
  opts: DefaultMissionValidatorFactoryOptions = {},
): MissionValidatorFactory {
  return (ctx) => buildDefaultMissionValidators(ctx, opts)
}

export function buildDefaultMissionValidators(
  ctx: ValidatorFactoryContext,
  opts: DefaultMissionValidatorFactoryOptions = {},
): MissionValidator[] {
  const geminiKey = resolveValidatorSecret('gemini', GEMINI_SECRET_NAMES, ctx, opts)
  const openaiKey = resolveValidatorSecret('openai', OPENAI_SECRET_NAMES, ctx, opts)
  const validators: MissionValidator[] = []

  if (geminiKey) {
    validators.push(new GeminiValidator({
      ...opts.geminiOptions,
      apiKey: geminiKey,
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    }))
  }
  if (openaiKey) {
    validators.push(new OpenAIValidator({
      ...opts.openaiOptions,
      apiKey: openaiKey,
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    }))
  }

  return validators
}

export function inspectDefaultMissionValidatorSecrets(
  ctx: ValidatorFactoryContext,
  opts: DefaultMissionValidatorFactoryOptions = {},
): DefaultValidatorSecretStatus {
  const geminiConfigured = Boolean(resolveValidatorSecret('gemini', GEMINI_SECRET_NAMES, ctx, opts))
  const openaiConfigured = Boolean(resolveValidatorSecret('openai', OPENAI_SECRET_NAMES, ctx, opts))
  return {
    geminiConfigured,
    openaiConfigured,
    configuredCount: Number(geminiConfigured) + Number(openaiConfigured),
    missingProviders: [
      ...(!geminiConfigured ? ['gemini' as const] : []),
      ...(!openaiConfigured ? ['openai' as const] : []),
    ],
  }
}

function resolveValidatorSecret(
  provider: 'gemini' | 'openai',
  names: readonly ValidatorSecretName[],
  ctx: ValidatorFactoryContext,
  opts: DefaultMissionValidatorFactoryOptions,
): string | undefined {
  const resolved = opts.secretResolver?.({ ...ctx, provider, names })
  if (resolved) return resolved

  const env = opts.env ?? process.env
  for (const name of names) {
    const value = env[name]
    if (!value) continue
    if (opts.secretGrants && !hasActiveTaskGrant(name, ctx.taskId, opts.secretGrants, opts.now ?? new Date())) {
      continue
    }
    return value
  }
  return undefined
}

function hasActiveTaskGrant(secretName: string, taskId: string, grants: SecretGrant[], now: Date): boolean {
  const nowMs = now.getTime()
  return grants.some((grant) =>
    grant.secretName === secretName &&
    grant.taskId === taskId &&
    grant.status === 'active' &&
    Date.parse(grant.expiresAt) > nowMs
  )
}
