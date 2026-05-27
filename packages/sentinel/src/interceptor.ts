import type { EventLog } from '@aedev/event-log'
import { classify, type SentinelVerdict, type ToolCall, type VerdictWithReason } from './policy.js'
import { SentinelBudget } from './budget.js'

export interface InterceptorOpts {
  log: EventLog
  taskId: string
  actor?: string
  /** Token cost of one sentinel review. Production wires this to the
   *  Haiku tokenizer; default mocks it. */
  reviewCostTokens?: number
  budget?: SentinelBudget
  now?: () => Date
}

export interface InterceptResult {
  verdict: SentinelVerdict
  reason: string
  callId: string
}

export class ToolCallSentinel {
  private readonly log: EventLog
  private readonly taskId: string
  private readonly actor: string
  private readonly reviewCost: number
  readonly budget: SentinelBudget
  private readonly now: () => Date

  constructor(opts: InterceptorOpts) {
    this.log = opts.log
    this.taskId = opts.taskId
    this.actor = opts.actor ?? 'daemon.sentinel'
    this.reviewCost = opts.reviewCostTokens ?? 250
    this.budget = opts.budget ?? new SentinelBudget()
    this.now = opts.now ?? (() => new Date())
  }

  async intercept(call: ToolCall, callId: string): Promise<InterceptResult> {
    this.budget.addSentinel(this.reviewCost)
    const v: VerdictWithReason = classify(call)
    await this.log.append({
      task_id: this.taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'sentinel.tool_call.classified',
      payload: { callId, tool: call.tool, verdict: v.verdict, reason: v.reason, matched: v.matched },
      idempotency_source: `${this.taskId}|sentinel.tool_call.classified|${callId}`,
    })
    if (v.verdict !== 'allow') {
      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: v.verdict === 'hard_block' ? 'sentinel.tool_call.hardblocked' : 'sentinel.tool_call.softblocked',
        payload: { callId, tool: call.tool, reason: v.reason },
        idempotency_source: `${this.taskId}|sentinel.${v.verdict}|${callId}`,
      })
    }
    return { verdict: v.verdict, reason: v.reason, callId }
  }
}
