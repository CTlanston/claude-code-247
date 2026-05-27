/** Stage M4 — sentinel budget tracker. */

export class SentinelBudget {
  private totalTokens = 0
  private sentinelTokens = 0
  /** Add to total token budget (any token the system has spent). */
  addTotal(n: number): void { this.totalTokens += n }
  /** Tokens spent specifically on sentinel reviews. */
  addSentinel(n: number): void { this.sentinelTokens += n; this.totalTokens += n }
  fraction(): number {
    if (this.totalTokens === 0) return 0
    return this.sentinelTokens / this.totalTokens
  }
  snapshot() {
    return { total: this.totalTokens, sentinel: this.sentinelTokens, fraction: this.fraction() }
  }
}
