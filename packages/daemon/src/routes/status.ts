import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'

export function registerStatusRoutes(app: FastifyInstance, db: AedevDb, startTime: Date): void {
  app.get('/status', async () => ({
    status: 'running',
    version: '0.0.1',
    uptime: Math.floor((Date.now() - startTime.getTime()) / 1000),
    lastHeartbeat: db.queryEvents({ type: 'heartbeat', limit: 1 })[0]?.createdAt ?? null,
  }))
}
