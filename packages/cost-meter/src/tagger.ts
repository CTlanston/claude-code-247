/** L2.1 cost-meter — tagger.
 *
 * Tags cost-bearing events with an estimated USD figure. The model
 * price table is the source of truth at the daemon boundary; this
 * module only computes from the (model, in_tokens, out_tokens) tuple.
 *
 * Workbook §3 Phase L2.1: "Tag rate 100% on cost-bearing events".
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMillion: number
  /** USD per 1M output tokens. */
  outputPerMillion: number
}

/** Known Claude model prices (USD per 1M tokens). Anthropic publishes
 *  these; we hardcode current snapshot. Hot-swap by passing a custom
 *  table to CostTagger. */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':       { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-sonnet-4-6':     { inputPerMillion:  3.0, outputPerMillion: 15.0 },
  'claude-haiku-4-5-20251001': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
}

export interface UsageInput {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface CostTag {
  /** Estimated cost in USD. */
  costUsd: number
  /** Model used; copied through for grouping. */
  model: string
  /** Token totals (for audit). */
  inputTokens: number
  outputTokens: number
}

export class CostTagger {
  private readonly pricing: Record<string, ModelPricing>

  constructor(pricing: Record<string, ModelPricing> = DEFAULT_PRICING) {
    this.pricing = pricing
  }

  /** Compute a cost tag for a single call. Unknown model returns 0 with
   *  the model name preserved so the reconciler can flag the gap. */
  tag(u: UsageInput): CostTag {
    const p = this.pricing[u.model]
    if (!p) {
      return { costUsd: 0, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens }
    }
    const inCost = (u.inputTokens / 1_000_000) * p.inputPerMillion
    const outCost = (u.outputTokens / 1_000_000) * p.outputPerMillion
    return {
      costUsd: round2(inCost + outCost),
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
    }
  }

  /** True iff the tagger knows this model. */
  knows(model: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.pricing, model)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
