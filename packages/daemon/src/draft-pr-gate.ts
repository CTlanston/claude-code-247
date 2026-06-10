import { createHash } from 'crypto'
import type { MissionDagTask, Repo, ValidatorResult } from '@aedev/core'

export interface DraftPrGateConfig {
  allowRemoteWrites: boolean
  /** GR#3 (v4 P4): repo names allowed to receive remote writes. The gate
   *  fail-closes — a repo not on this list is blocked even when the global
   *  `allow_remote_writes` flag is on. An empty list blocks every repo. */
  remoteWriteWhitelist: string[]
}

export interface DraftPrRequest {
  repo: Repo
  missionId: string
  title: string
  branch: string
  base: string
  changedPaths: string[]
  evidenceUri: string
  riskScore: number
  validatorResults: ValidatorResult[]
  taskDag?: MissionDagTask[]
  rollbackNotes: string
}

export interface DraftPrInfo {
  number: number
  url: string
  state: string
  draft: true
}

export interface GitRemoteWriter {
  pushBranch(repo: Repo, branch: string, idempotencyKey: string): Promise<void>
}

export interface DraftPrCreator {
  createDraftPr(req: {
    repo: Repo
    title: string
    body: string
    head: string
    base: string
    idempotencyKey: string
  }): Promise<DraftPrInfo>
}

export class DraftPrGateError extends Error {
  constructor(message: string, readonly code: 'REMOTE_WRITES_DISABLED' | 'REPO_NOT_WHITELISTED' | 'REPO_DISABLED' | 'FORBIDDEN_PATH') {
    super(message)
    this.name = 'DraftPrGateError'
  }
}

export class DraftPrGate {
  constructor(
    private readonly config: DraftPrGateConfig,
    private readonly git: GitRemoteWriter,
    private readonly pr: DraftPrCreator,
  ) {}

  async openDraftPr(req: DraftPrRequest): Promise<DraftPrInfo> {
    if (!this.config.allowRemoteWrites) {
      throw new DraftPrGateError('allow_remote_writes=false blocks branch push and draft PR creation', 'REMOTE_WRITES_DISABLED')
    }
    if (!this.config.remoteWriteWhitelist.includes(req.repo.name)) {
      throw new DraftPrGateError(
        `repo ${req.repo.name} is not on the remote-write whitelist (${this.config.remoteWriteWhitelist.length ? this.config.remoteWriteWhitelist.join(', ') : 'empty'})`,
        'REPO_NOT_WHITELISTED',
      )
    }
    if (!req.repo.enabled) {
      throw new DraftPrGateError(`repo ${req.repo.name} is disabled`, 'REPO_DISABLED')
    }
    const forbidden = req.changedPaths.find((path) => req.repo.forbiddenPaths.some((pattern) => match(pattern, path)))
    if (forbidden) {
      throw new DraftPrGateError(`changed path ${forbidden} is forbidden`, 'FORBIDDEN_PATH')
    }

    const idempotencyKey = draftPrIdempotencyKey(req.missionId, req.branch, req.title)
    await this.git.pushBranch(req.repo, req.branch, idempotencyKey)
    return this.pr.createDraftPr({
      repo: req.repo,
      title: req.title,
      body: renderDraftPrBody(req),
      head: req.branch,
      base: req.base,
      idempotencyKey,
    })
  }
}

export function renderDraftPrBody(req: DraftPrRequest): string {
  const validators = req.validatorResults.length
    ? req.validatorResults.map((v) => `- ${v.validator}: ${v.verdict}${v.summary ? ` - ${v.summary}` : ''}`).join('\n')
    : '- None recorded'
  const dag = req.taskDag?.length
    ? req.taskDag.map((t) => `- ${t.id} [${t.role}]: ${t.title}`).join('\n')
    : '- Not attached'

  return [
    `# ${req.title}`,
    '',
    `Mission: ${req.missionId}`,
    `Evidence: ${req.evidenceUri}`,
    `Risk score: ${req.riskScore}`,
    '',
    '## Task DAG',
    dag,
    '',
    '## Validators',
    validators,
    '',
    '## Rollback',
    req.rollbackNotes,
    '',
    '> v2.3 policy: this PR is draft-only. Automatic merge is disabled.',
    '',
  ].join('\n')
}

export function draftPrIdempotencyKey(missionId: string, branch: string, title: string): string {
  return `sha256:${createHash('sha256').update(`${missionId}|${branch}|${title}|draft-pr`).digest('hex')}`
}

function match(pattern: string, p: string): boolean {
  const sentinel = '\u0001\u0001'
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, sentinel)
        .replace(/\*/g, '[^/]*')
        .replace(new RegExp(sentinel, 'g'), '.*') +
      '$',
  )
  return re.test(p)
}
