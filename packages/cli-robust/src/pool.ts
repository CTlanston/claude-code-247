/** Stage M1 — CLI session pool.
 *
 * Maintains N parallel subscription sessions; if one fails the canary,
 * the pool removes it and continues serving from the remaining ones.
 * cli_session_pool_min SLO (workbook §0) is 1 — we never let the pool
 * go to zero without a HOLD.
 */

export interface SessionRef {
  id: string
  /** Health verdict from the last probe. */
  healthy: boolean
}

export class SessionPool {
  private readonly sessions = new Map<string, SessionRef>()
  private readonly minimum: number

  constructor(opts: { initial?: SessionRef[]; minimum?: number } = {}) {
    for (const s of opts.initial ?? []) this.sessions.set(s.id, s)
    this.minimum = opts.minimum ?? 1
  }

  add(s: SessionRef): void {
    this.sessions.set(s.id, s)
  }

  markUnhealthy(id: string): void {
    const s = this.sessions.get(id)
    if (s) s.healthy = false
  }

  /** Evict an unhealthy session; throws if doing so would breach the minimum. */
  evict(id: string): void {
    const next = [...this.sessions.values()].filter((s) => s.healthy && s.id !== id)
    if (next.length < this.minimum) {
      throw new Error(`pool below minimum (${this.minimum}); refuse evict`)
    }
    this.sessions.delete(id)
  }

  /** Returns one healthy session, round-robin-ish. Throws if none. */
  acquire(): SessionRef {
    const healthy = [...this.sessions.values()].filter((s) => s.healthy)
    if (healthy.length === 0) throw new Error('no healthy sessions in pool')
    return healthy[Math.floor(Math.random() * healthy.length)]
  }

  size(): number {
    return this.sessions.size
  }

  healthyCount(): number {
    return [...this.sessions.values()].filter((s) => s.healthy).length
  }
}
