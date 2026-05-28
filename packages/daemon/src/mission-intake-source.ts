import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import type { EventLog } from '@aedev/event-log'
import { createOctokit, type ImportedIssue } from '@aedev/github'

export type IntakeSourceKind = 'manual' | 'roadmap' | 'github-issue' | 'todo' | 'failing-test'
export type IntakeDecision = 'execute_now' | 'proposal_only' | 'blocked'

export interface IntakeCandidate {
  id: string
  source: IntakeSourceKind
  title: string
  body: string
  repoId?: string
  labels?: string[]
  files?: string[]
}

export interface ClassifiedIntakeCandidate extends IntakeCandidate {
  decision: IntakeDecision
  reason: string
}

export interface IntakeBatchResult {
  accepted: ClassifiedIntakeCandidate[]
  overflow: IntakeCandidate[]
  cap: number
}

export interface GitHubIssueScannerOptions {
  owner: string
  repo: string
  repoId?: string
  limit?: number
  labels?: string[]
  token?: string
  listIssues?: (params: { owner: string; repo: string; limit: number; labels?: string[]; token?: string }) => Promise<ImportedIssue[]>
}

export interface TodoScannerOptions {
  repoPath: string
  repoId?: string
  limit?: number
  includeGlobs?: RegExp[]
  excludeDirs?: string[]
}

export interface FailingTestScannerOptions {
  repoPath: string
  repoId?: string
  limit?: number
  command?: string[]
  runCommand?: (command: string[], cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
}

export interface MissionIntakeSourceOptions {
  taskId: string
  cap?: number
  log?: EventLog
  manual?: IntakeCandidate[]
  roadmap?: IntakeCandidate[]
  github?: GitHubIssueScannerOptions
  todo?: TodoScannerOptions
  failingTests?: FailingTestScannerOptions
}

export interface MissionIntakeScanResult extends IntakeBatchResult {
  candidates: IntakeCandidate[]
}

const BLOCK_PATTERNS = [
  /\.env\b|secrets\//i,
  /delete\s+event_log|drop\s+table|git\s+push\s+--force/i,
  /exfiltrate|keychain|credential/i,
]

const SENSITIVE_PATTERNS = [
  /\.github|workflow|CI/i,
  /auth|security|token|secret|permission/i,
  /dependency|package\.json|pnpm-lock/i,
  /migration|schema|ADR|architecture/i,
]

export function classifyIntakeCandidate(candidate: IntakeCandidate): ClassifiedIntakeCandidate {
  const text = [candidate.title, candidate.body, ...(candidate.labels ?? []), ...(candidate.files ?? [])].join('\n')
  if (BLOCK_PATTERNS.some((re) => re.test(text))) {
    return { ...candidate, decision: 'blocked', reason: 'blocked by destructive or secret-touching pattern' }
  }
  if (candidate.source !== 'manual' && SENSITIVE_PATTERNS.some((re) => re.test(text))) {
    return { ...candidate, decision: 'proposal_only', reason: 'sensitive non-manual source requires approval' }
  }
  if (candidate.source === 'github-issue' && !(candidate.labels ?? []).includes('aedev:auto')) {
    return { ...candidate, decision: 'proposal_only', reason: 'GitHub issue lacks aedev:auto label' }
  }
  if (candidate.source === 'todo') {
    return { ...candidate, decision: 'proposal_only', reason: 'TODO candidates are noisy until approved' }
  }
  return { ...candidate, decision: 'execute_now', reason: 'low-risk candidate' }
}

export async function classifyIntakeBatch(
  taskId: string,
  candidates: IntakeCandidate[],
  opts: { cap?: number; log?: EventLog } = {},
): Promise<IntakeBatchResult> {
  const cap = opts.cap ?? 25
  const acceptedRaw = candidates.slice(0, cap)
  const overflow = candidates.slice(cap)
  const accepted = acceptedRaw.map(classifyIntakeCandidate)

  if (opts.log) {
    await opts.log.append({
      task_id: taskId,
      actor: 'daemon.mission-intake',
      kind: 'intake.scan.summary',
      payload: {
        candidates: candidates.length,
        accepted: accepted.length,
        overflow: overflow.length,
        cap,
      },
      idempotency_source: `${taskId}|intake.scan.summary|${candidates.map((c) => c.id).join(',')}`,
    })
    if (overflow.length > 0) {
      await opts.log.append({
        task_id: taskId,
        actor: 'daemon.mission-intake',
        kind: 'hold.policy.created',
        payload: { reason: 'intake_overflow', overflow: overflow.length, cap },
        idempotency_source: `${taskId}|hold.policy.created|intake_overflow|${new Date().toISOString().slice(0, 10)}`,
      })
    }
  }

  return { accepted, overflow, cap }
}

export class MissionIntakeSource {
  constructor(private readonly opts: MissionIntakeSourceOptions) {}

  async collectCandidates(): Promise<IntakeCandidate[]> {
    const candidates: IntakeCandidate[] = []
    candidates.push(...(this.opts.manual ?? []))
    candidates.push(...(this.opts.roadmap ?? []))
    if (this.opts.github) candidates.push(...await scanGitHubIssueCandidates(this.opts.github))
    if (this.opts.todo) candidates.push(...scanTodoCandidates(this.opts.todo))
    if (this.opts.failingTests) candidates.push(...await scanFailingTestCandidates(this.opts.failingTests))
    return dedupeCandidates(candidates)
  }

  async scan(): Promise<MissionIntakeScanResult> {
    const candidates = await this.collectCandidates()
    const batch = await classifyIntakeBatch(this.opts.taskId, candidates, {
      cap: this.opts.cap,
      log: this.opts.log,
    })
    return { ...batch, candidates }
  }
}

export async function scanGitHubIssueCandidates(opts: GitHubIssueScannerOptions): Promise<IntakeCandidate[]> {
  const listIssues = opts.listIssues ?? listGitHubIssues
  const issues = await listIssues({
    owner: opts.owner,
    repo: opts.repo,
    limit: opts.limit ?? 20,
    labels: opts.labels,
    token: opts.token,
  })

  return issues.slice(0, opts.limit ?? 20).map((issue) => ({
    id: `github-issue-${issue.number}`,
    source: 'github-issue',
    title: issue.title,
    body: `Imported from GitHub issue #${issue.number}: ${issue.url}\n\n${issue.body}`,
    repoId: opts.repoId,
    labels: issue.labels,
  }))
}

async function listGitHubIssues(
  params: { owner: string; repo: string; limit: number; labels?: string[]; token?: string }
): Promise<ImportedIssue[]> {
  const octokit = createOctokit(params.token)
  const { data } = await octokit.rest.issues.listForRepo({
    owner: params.owner,
    repo: params.repo,
    state: 'open',
    per_page: Math.min(Math.max(params.limit, 1), 100),
    ...(params.labels?.length ? { labels: params.labels.join(',') } : {}),
  })

  return data
    .filter((issue) => !('pull_request' in issue))
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      url: issue.html_url,
      labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name ?? '')).filter(Boolean),
    }))
}

export function scanTodoCandidates(opts: TodoScannerOptions): IntakeCandidate[] {
  const limit = opts.limit ?? 50
  const includeGlobs = opts.includeGlobs ?? DEFAULT_INCLUDE_PATTERNS
  const excludeDirs = new Set(opts.excludeDirs ?? DEFAULT_EXCLUDE_DIRS)
  const candidates: IntakeCandidate[] = []

  walkRepo(opts.repoPath, excludeDirs, (path) => {
    if (candidates.length >= limit) return false
    const rel = relative(opts.repoPath, path)
    if (!includeGlobs.some((pattern) => pattern.test(rel))) return true

    const content = safeReadText(path)
    if (!content) return true
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!TODO_PATTERN.test(line)) continue
      candidates.push({
        id: `todo-${rel}:${i + 1}`,
        source: 'todo',
        title: `TODO in ${rel}:${i + 1}`,
        body: line.trim(),
        repoId: opts.repoId,
        files: [rel],
      })
      if (candidates.length >= limit) return false
    }
    return true
  })

  return candidates
}

export async function scanFailingTestCandidates(opts: FailingTestScannerOptions): Promise<IntakeCandidate[]> {
  const command = opts.command ?? ['pnpm', 'test', '--', '--reporter=json']
  if (!opts.runCommand) return []
  const result = await opts.runCommand(command, opts.repoPath)
  return parseFailingTestCandidates(result.stdout, result.stderr, {
    repoId: opts.repoId,
    limit: opts.limit ?? 20,
  })
}

function parseFailingTestCandidates(
  stdout: string,
  stderr: string,
  opts: { repoId?: string; limit: number }
): IntakeCandidate[] {
  const parsed = tryParseJsonFromStream(stdout)
  if (!parsed || typeof parsed !== 'object') {
    return stderr.trim()
      ? [{
        id: 'failing-test-runner-error',
        source: 'failing-test',
        title: 'Investigate failing test command',
        body: stderr.trim().slice(0, 4000),
        repoId: opts.repoId,
      }]
      : []
  }

  const suites = Array.isArray((parsed as Record<string, unknown>)['testResults'])
    ? (parsed as Record<string, unknown>)['testResults'] as Array<Record<string, unknown>>
    : []

  const candidates: IntakeCandidate[] = []
  for (const suite of suites) {
    const file = typeof suite['name'] === 'string' ? suite['name'] : undefined
    const assertions = Array.isArray(suite['assertionResults'])
      ? suite['assertionResults'] as Array<Record<string, unknown>>
      : []
    for (const assertion of assertions) {
      if (assertion['status'] !== 'failed') continue
      const title = Array.isArray(assertion['ancestorTitles'])
        ? [...(assertion['ancestorTitles'] as string[]), String(assertion['title'] ?? 'unnamed test')].join(' > ')
        : String(assertion['title'] ?? 'unnamed test')
      const messages = Array.isArray(assertion['failureMessages'])
        ? (assertion['failureMessages'] as string[]).join('\n\n')
        : ''
      candidates.push({
        id: `failing-test-${file ?? 'unknown'}:${title}`,
        source: 'failing-test',
        title: `Fix failing test: ${title}`,
        body: [file ? `File: ${file}` : '', messages].filter(Boolean).join('\n\n'),
        repoId: opts.repoId,
        ...(file ? { files: [file] } : {}),
      })
      if (candidates.length >= opts.limit) return candidates
    }
  }
  return candidates
}

function dedupeCandidates(candidates: IntakeCandidate[]): IntakeCandidate[] {
  const seen = new Set<string>()
  const unique: IntakeCandidate[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    unique.push(candidate)
  }
  return unique
}

const TODO_PATTERN = /\b(?:TODO|FIXME|XXX)\b/i
const DEFAULT_INCLUDE_PATTERNS = [
  /\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|yml|yaml|sh)$/i,
]
const DEFAULT_EXCLUDE_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'evidence',
  '.next',
]

function walkRepo(root: string, excludeDirs: Set<string>, visit: (path: string) => boolean | void): void {
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && excludeDirs.has(entry.name)) continue
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      walkRepo(fullPath, excludeDirs, visit)
      continue
    }
    const keepGoing = visit(fullPath)
    if (keepGoing === false) return
  }
}

function safeReadText(path: string): string | null {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    const content = readFileSync(path, 'utf8')
    return content.includes('\0') ? null : content
  } catch {
    return null
  }
}

function tryParseJsonFromStream(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)) as unknown } catch { return null }
    }
    return null
  }
}
