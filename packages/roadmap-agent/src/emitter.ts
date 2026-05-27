import type { EventLog } from '@aedev/event-log'
import type { ClassifiedProposal } from './classifier.js'

export interface EmitterOpts {
  log: EventLog
  actor?: string
  now?: () => Date
}

export class ProposalEmitter {
  private readonly log: EventLog
  private readonly actor: string
  private readonly now: () => Date

  constructor(opts: EmitterOpts) {
    this.log = opts.log
    this.actor = opts.actor ?? 'daemon.roadmap-agent'
    this.now = opts.now ?? (() => new Date())
  }

  async scanStarted(taskId: string, source: string): Promise<void> {
    await this.log.append({
      task_id: taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'roadmap.scan.started',
      payload: { source },
      idempotency_source: `${taskId}|roadmap.scan.started|${source}|${this.now().toISOString()}`,
    })
  }

  async emit(taskId: string, p: ClassifiedProposal): Promise<string> {
    return this.log.append({
      task_id: taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'roadmap.proposal.emitted',
      payload: { proposalId: p.id, text: p.text, track: p.track, reason: p.reason },
      idempotency_source: `${taskId}|roadmap.proposal.emitted|${p.id}`,
    })
  }

  /** CC_RESTORE_SPEC T3 — emit candidate count BEFORE classifying. Gives
   *  the operator visibility into "how many did we see" even if the cap
   *  drops everything. */
  async scanSummary(taskId: string, summary: { source: string; candidates: number; cap: number }): Promise<void> {
    await this.log.append({
      task_id: taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'roadmap.scan.summary',
      payload: summary,
      idempotency_source: `${taskId}|roadmap.scan.summary|${summary.source}|${this.now().toISOString()}`,
    })
  }

  /** CC_RESTORE_SPEC T3 — when more eligible candidates than the cap,
   *  emit a HOLD-class event so the operator triages the rest. */
  async overflowHold(taskId: string, detail: { source: string; candidates: number; eligible: number; emitted: number; overflow: number; cap: number }): Promise<void> {
    await this.log.append({
      task_id: taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'hold.policy.created',
      payload: { reason: 'roadmap_scan_overflow', ...detail },
      idempotency_source: `${taskId}|hold.policy.created|roadmap_scan_overflow|${this.now().toISOString().slice(0, 10)}`,
    })
  }
}
