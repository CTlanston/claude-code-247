export const PAID_API_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_URL',
  'OPENAI_API_KEY',
  'AEDEV_OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
] as const

export type PaidApiEnvKey = typeof PAID_API_ENV_KEYS[number]

export function buildPlannerCoderEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = { ...env }
  for (const key of PAID_API_ENV_KEYS) delete safeEnv[key]
  return safeEnv
}

export function paidApiKeysPresent(env: NodeJS.ProcessEnv): PaidApiEnvKey[] {
  return PAID_API_ENV_KEYS.filter((key) => Boolean(env[key]?.trim()))
}
