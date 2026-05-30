import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'

export function registerStatusRoutes(app: FastifyInstance, db: AedevDb, startTime: Date): void {
  app.get('/status', async () => ({
    status: 'running',
    version: '0.0.1',
    missionOs: {
      version: 'v2.4.0-patch1',
      autonomy: 'draft-pr-only',
      schedulerIntervalMs: Number(process.env['AEDEV_SCHEDULER_INTERVAL_MS'] ?? '60000'),
      workerConcurrency: { min: 1, max: Number(process.env['AEDEV_WORKER_MAX'] ?? '5') },
      intakeSources: ['manual', 'roadmap', 'github-issue', 'todo', 'failing-test'],
    },
    uptime: Math.floor((Date.now() - startTime.getTime()) / 1000),
    lastHeartbeat: db.queryEvents({ type: 'heartbeat', limit: 1 })[0]?.createdAt ?? null,
  }))
}
