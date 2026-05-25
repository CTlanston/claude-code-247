import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { z } from 'zod'

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
})

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
