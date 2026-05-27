import type { EventLog } from '@aedev/event-log'
import { CapTokenSigner, CapTokenVerifier, type CapVerifyError } from './cap-token.js'

export interface PushPolicyOpts {
  log: EventLog
  signer: CapTokenSigner
  verifier: CapTokenVerifier
  /** Forbidden paths refuse push regardless of cap-token validity. */
  forbiddenPaths?: string[]
  actor?: string
  now?: () => Date
}

export interface PushRequest {
  taskId: string
  branch: string
  actor: string
  capToken: string
  /** Optional manifest of paths the push would touch — checked vs forbiddenPaths. */
  paths?: string[]
}

export interface PushOutcome {
  allowed: boolean
  error?: CapVerifyError | 'forbidden_path'
  reason?: string
}

export class PushPolicy {
  private readonly log: EventLog
  private readonly signer: CapTokenSigner
  private readonly verifier: CapTokenVerifier
  private readonly forbidden: string[]
  private readonly actor: string
  private readonly now: () => Date

  constructor(opts: PushPolicyOpts) {
    this.log = opts.log
    this.signer = opts.signer
    this.verifier = opts.verifier
    this.forbidden = opts.forbiddenPaths ?? ['.env*', 'secrets/**', '.github/**', 'CLAUDE.md', 'AGENTS.md']
    this.actor = opts.actor ?? 'daemon.push-policy'
    this.now = opts.now ?? (() => new Date())
  }

  issueCapToken(args: { taskId: string; branch: string; actor: string; ttlMs?: number }): string {
    return this.signer.sign({
      taskId: args.taskId, branch: args.branch, actor: args.actor,
      ttlMs: args.ttlMs ?? 5 * 60 * 1000, now: this.now().getTime(),
    }).encoded
  }

  async authorize(req: PushRequest): Promise<PushOutcome> {
    const ts = this.now().toISOString()
    // Event 1: push.cap.requested
    await this.log.append({
      task_id: req.taskId,
      ts,
      actor: this.actor,
      kind: 'push.cap.requested',
      payload: { branch: req.branch, actor: req.actor, paths: req.paths ?? [] },
      idempotency_source: `${req.taskId}|push.cap.requested|${ts}|${req.branch}`,
    })

    // Forbidden-path short-circuit BEFORE verifying token.
    const violation = (req.paths ?? []).find((p) => this.forbidden.some((g) => match(g, p)))
    if (violation) {
      await this.log.append({
        task_id: req.taskId,
        ts,
        actor: this.actor,
        kind: 'push.cap.denied',
        payload: { reason: 'forbidden_path', path: violation },
      })
      return { allowed: false, error: 'forbidden_path', reason: `path ${violation} is forbidden` }
    }

    const v = this.verifier.verify(req.capToken, {
      expectedTaskId: req.taskId,
      expectedBranch: req.branch,
      expectedActor: req.actor,
      now: this.now().getTime(),
    })
    if (!v.ok) {
      await this.log.append({
        task_id: req.taskId,
        ts,
        actor: this.actor,
        kind: 'push.cap.denied',
        payload: { reason: v.error, tid: v.claims?.tid ?? null },
      })
      return { allowed: false, error: v.error, reason: v.error }
    }
    await this.log.append({
      task_id: req.taskId,
      ts,
      actor: this.actor,
      kind: 'push.cap.allowed',
      payload: { branch: req.branch, actor: req.actor, tid: v.claims!.tid },
    })
    return { allowed: true }
  }
}

/**
 * Minimal glob match — supports `*` (single segment) and `**` (any depth).
 * Adequate for forbidden_paths matching; not a general-purpose globber.
 */
function match(pattern: string, p: string): boolean {
  // Two-pass: replace ** with a sentinel that cannot collide with the *
  // pass, then substitute the sentinel back to .* at the end.
  const SENTINEL = ''
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, SENTINEL)
        .replace(/\*/g, '[^/]*')
        .replace(new RegExp(SENTINEL, 'g'), '.*') +
      '$',
  )
  return re.test(p)
}
