import type { AedevDb, Event } from '@aedev/core'

export class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private db: AedevDb,
    private intervalMs: number = 30_000,
  ) {}

  start(): void {
    this.writeHeartbeat()
    this.timer = setInterval(() => this.writeHeartbeat(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private writeHeartbeat(): void {
    this.db.insertEvent('heartbeat', undefined, undefined, { ts: new Date().toISOString() })
  }

  getLastHeartbeat(): Event | undefined {
    return this.db.queryEvents({ type: 'heartbeat', limit: 1 })[0]
  }
}
