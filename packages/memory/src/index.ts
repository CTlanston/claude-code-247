import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { AedevDb, Event, Repo } from '@aedev/core'

export interface Tier2Lesson {
  id: string
  missionId: string
  repoId?: string
  kind: 'gemini_rejection' | 'draft_pr_block'
  reason: string
  summary?: string
  createdAt: string
}

export interface SemanticMemory {
  search(query: string, opts?: { repoId?: string; limit?: number }): Promise<Array<{ text: string; score: number; source: string }>>
}

export function repoTier1MemoryPath(repo: Pick<Repo, 'path' | 'name'>): string {
  return join(repo.path, '.aedev', 'cowork-memory.md')
}

export function operatorPrefsPath(homeDir = process.env['HOME'] ?? process.cwd()): string {
  return join(homeDir, '.aedev', 'operator-prefs.md')
}

export function ensureTier1MemoryFiles(repo: Pick<Repo, 'path' | 'name'>, homeDir?: string): { repoMemoryPath: string; operatorPrefsPath: string } {
  const repoMemoryPath = repoTier1MemoryPath(repo)
  const prefsPath = operatorPrefsPath(homeDir)
  if (!existsSync(repoMemoryPath)) writeMemoryFile(repoMemoryPath, initialRepoMemory(repo.name))
  if (!existsSync(prefsPath)) writeMemoryFile(prefsPath, initialOperatorPrefs())
  return { repoMemoryPath, operatorPrefsPath: prefsPath }
}

export function projectTier2Lessons(db: AedevDb, opts: { repoId?: string; limit?: number } = {}): Tier2Lesson[] {
  const missionsById = new Map(db.listMissions(opts.repoId).map((m) => [m.id, m]))
  const out: Tier2Lesson[] = []
  for (const event of db.queryEvents({ limit: opts.limit ?? 500 })) {
    const mission = event.entityType === 'mission' && event.entityId ? missionsById.get(event.entityId) : undefined
    if (opts.repoId && !mission) continue
    const lesson = lessonFromEvent(event, mission?.repoId)
    if (lesson) out.push(lesson)
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function compileTier2LessonsToTier1(repo: Pick<Repo, 'path' | 'name'>, lessons: Tier2Lesson[], homeDir?: string): string {
  const paths = ensureTier1MemoryFiles(repo, homeDir)
  const current = readFileSync(paths.repoMemoryPath, 'utf8')
  const relevant = lessons.filter((l) => l.kind === 'gemini_rejection')
  if (relevant.length === 0) return current
  const existing = new Set((current.match(/<!-- lesson:[^>]+ -->/g) ?? []).map((m) => m.slice('<!-- lesson:'.length, -' -->'.length)))
  const additions = relevant
    .filter((lesson) => !existing.has(lesson.id))
    .map((lesson) => [
      `<!-- lesson:${lesson.id} -->`,
      `- ${lesson.reason}${lesson.summary ? ` (${lesson.summary})` : ''}`,
    ].join('\n'))
  if (!additions.length) return current
  const heading = current.includes('## Gemini Rejection Lessons') ? '' : '\n\n## Gemini Rejection Lessons'
  const next = `${current.trimEnd()}${heading}\n${additions.join('\n')}\n`
  writeMemoryFile(paths.repoMemoryPath, next)
  return next
}

export function buildMemoryContext(repo: Pick<Repo, 'path' | 'name'>, homeDir?: string): string {
  const paths = ensureTier1MemoryFiles(repo, homeDir)
  return [
    '# Team Memory Context',
    '',
    `Repo memory (${basename(paths.repoMemoryPath)}):`,
    readFileSync(paths.repoMemoryPath, 'utf8').trim(),
    '',
    `Operator preferences (${basename(paths.operatorPrefsPath)}):`,
    readFileSync(paths.operatorPrefsPath, 'utf8').trim(),
  ].join('\n')
}

function lessonFromEvent(event: Event, repoId?: string): Tier2Lesson | null {
  if (!event.entityId) return null
  if (event.type === 'operator.gemini_pr_blocked') {
    const reason = stringPayload(event, 'reason') || stringPayload(event, 'summary') || 'Gemini blocked the Draft PR.'
    return {
      id: `${event.id}-gemini`,
      missionId: event.entityId,
      ...(repoId ? { repoId } : {}),
      kind: 'gemini_rejection',
      reason,
      summary: stringPayload(event, 'summary'),
      createdAt: event.createdAt,
    }
  }
  if (event.type === 'operator.draft_pr_blocked' && stringPayload(event, 'code')?.startsWith('GEMINI_')) {
    return {
      id: `${event.id}-draft-pr`,
      missionId: event.entityId,
      ...(repoId ? { repoId } : {}),
      kind: 'draft_pr_block',
      reason: stringPayload(event, 'reason') || 'Draft PR was blocked by Gemini hard gate.',
      createdAt: event.createdAt,
    }
  }
  return null
}

function stringPayload(event: Event, key: string): string | undefined {
  const value = event.payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function writeMemoryFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function initialRepoMemory(repoName: string): string {
  return [
    `# Cowork Memory: ${repoName}`,
    '',
    '## Architecture',
    '- No durable repo-specific architecture lessons recorded yet.',
    '',
    '## Commands',
    '- No durable repo-specific command lessons recorded yet.',
    '',
    '## Hazards',
    '- No durable repo-specific hazards recorded yet.',
  ].join('\n')
}

function initialOperatorPrefs(): string {
  return [
    '# Operator Preferences',
    '',
    '- Prefer local subscription CLI execution for planner/coder work.',
    '- Treat missing validator results as blocked, never as pass.',
  ].join('\n')
}
