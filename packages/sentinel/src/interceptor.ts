import type { EventLog } from '@aedev/event-log'
import { classify, type SentinelVerdict, type ToolCall, type VerdictWithReason } from './policy.js'
import { SentinelBudget } from './budget.js'
import type { LlmReviewer } from './llm-reviewer.js'

export interface InterceptorOpts {
  log: EventLog
  taskId: string
  actor?: string
  /** Token cost of one rule-based review. */
  reviewCostTokens?: number
  budget?: SentinelBudget
  now?: () => Date
  /** Optional LLM reviewer (Claude CLI subprocess). When provided, the
   *  interceptor calls it on rule-based soft_block to refine into a
   *  concrete allow / hard_block. Allow saves the call from being
   *  blocked unnecessarily; hard_block escalates per policy. */
  llm?: LlmReviewer
  /** Tokens charged per LLM second-opinion. Default 2000. */
  llmCostTokens?: number
}

export interface InterceptResult {
  verdict: SentinelVerdict
  reason: string
  callId: string
  /** True when the LLM refined the verdict away from the rule-based default. */
  llmEscalated?: boolean
}

export class ToolCallSentinel {
  private readonly log: EventLog
  private readonly taskId: string
  private readonly actor: string
  private readonly reviewCost: number
  readonly budget: SentinelBudget
  private readonly now: () => Date
  private readonly llm?: LlmReviewer
  private readonly llmCost: number

  constructor(opts: InterceptorOpts) {
    this.log = opts.log
    this.taskId = opts.taskId
    this.actor = opts.actor ?? 'daemon.sentinel'
    this.reviewCost = opts.reviewCostTokens ?? 250
    this.budget = opts.budget ?? new SentinelBudget()
    this.now = opts.now ?? (() => new Date())
    this.llm = opts.llm
    this.llmCost = opts.llmCostTokens ?? 2000
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

    let final: { verdict: SentinelVerdict; reason: string } = { verdict: v.verdict, reason: v.reason }
    let llmEscalated = false

    if (v.verdict === 'soft_block' && this.llm) {
      this.budget.addSentinel(this.llmCost)
      const llmRes = await this.llm.review(call)
      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: 'sentinel.llm.reviewed',
        payload: {
          callId, ruleVerdict: v.verdict, llmVerdict: llmRes.verdict,
          llmReason: llmRes.reason, latencyMs: llmRes.latencyMs, timedOut: llmRes.timedOut,
        },
        idempotency_source: `${this.taskId}|sentinel.llm.reviewed|${callId}`,
      })
      llmEscalated = true
      final = { verdict: llmRes.verdict, reason: llmRes.reason }
    }

    if (final.verdict === 'hard_block') {
      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: 'sentinel.tool_call.hardblocked',
        payload: { callId, tool: call.tool, reason: final.reason, viaLlm: llmEscalated },
        idempotency_source: `${this.taskId}|sentinel.hard_block|${callId}`,
      })
    } else if (final.verdict === 'soft_block') {
      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: 'sentinel.tool_call.softblocked',
        payload: { callId, tool: call.tool, reason: final.reason },
        idempotency_source: `${this.taskId}|sentinel.soft_block|${callId}`,
      })
    }

    return { verdict: final.verdict, reason: final.reason, callId, llmEscalated }
  }
}
