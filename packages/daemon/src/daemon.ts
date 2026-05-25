import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'
import { HeartbeatService } from './heartbeat.js'

export const DEFAULT_PORT = 7247

export class Daemon {
  private db!: AedevDb
  private heartbeat!: HeartbeatService
  private server!: ReturnType<typeof createServer>
  private startTime!: Date

  constructor(private config: { dbPath?: string; port?: number } = {}) {}

  async start(): Promise<void> {
    this.startTime = new Date()
    this.db = new AedevDb(this.config.dbPath ?? ':memory:')
    this.heartbeat = new HeartbeatService(this.db, 30_000)
    this.heartbeat.start()
    this.server = createServer(this.db, this.startTime)
    await this.server.listen({ port: this.config.port ?? DEFAULT_PORT, host: '127.0.0.1' })
  }

  async stop(): Promise<void> {
    this.heartbeat.stop()
    await this.server.close()
    this.db.close()
  }

  getDb(): AedevDb { return this.db }
}
