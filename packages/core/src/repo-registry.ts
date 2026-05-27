import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { z } from 'zod'

const PreviewBlockSchema = z.object({
  provider: z.enum(['cloudflare-pages', 'vercel', 'github-pages']).default('cloudflare-pages'),
  buildCommand: z.string().optional(),
  outputDir: z.string().optional(),
  externalPreviewRequired: z.boolean().default(false),
  tokenEnvVar: z.string().optional(),
})

const DeployBlockSchema = z.object({
  productionEnabled: z.boolean().default(false),
  lowRiskAutoDeploy: z.boolean().default(false),
  healthcheckUrl: z.string().url().optional(),
  rollback: z.enum(['direct_revert', 'manual']).default('direct_revert'),
})

const RiskBlockSchema = z.object({
  lowAutoMerge: z.boolean().default(false),
  maxLowRiskScore: z.number().int().min(0).max(100).default(30),
  sensitiveLanes: z.array(z.string()).default(['auth', 'payment', 'security', 'deployment']),
})

const SecretsBlockSchema = z.object({
  requireTemporaryGrants: z.boolean().default(true),
})

const RepoConfigSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),
  defaultBranch: z.string().default('main'),
  enabled: z.boolean().default(true),
  testCommands: z.array(z.string()).default([]),
  forbiddenPaths: z.array(z.string()).default(['.env*', 'secrets/**', '.github/**', 'CLAUDE.md', 'AGENTS.md']),
  mergePolicy: z.enum(['AUTO_MERGE', 'WAITING', 'BLOCKED']).default('WAITING'),
  preview: PreviewBlockSchema.optional(),
  deploy: DeployBlockSchema.optional(),
  risk: RiskBlockSchema.optional(),
  secrets: SecretsBlockSchema.optional(),
})

export type RepoPreviewConfig = z.infer<typeof PreviewBlockSchema>
export type RepoDeployConfig = z.infer<typeof DeployBlockSchema>
export type RepoRiskConfig = z.infer<typeof RiskBlockSchema>
export type RepoSecretsConfig = z.infer<typeof SecretsBlockSchema>

export type RepoConfig = z.infer<typeof RepoConfigSchema>

export function validateRepoConfig(raw: unknown): RepoConfig {
  return RepoConfigSchema.parse(raw)
}

export function loadReposYaml(filePath: string): RepoConfig[] {
  const content = readFileSync(filePath, 'utf8')
  const parsed = parse(content) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`repos.yaml must contain a YAML array, got: ${typeof parsed}`)
  }
  return parsed.map((entry, i) => {
    try { return validateRepoConfig(entry) }
    catch (e) { throw new Error(`repos.yaml entry #${i}: ${(e as Error).message}`) }
  })
}
