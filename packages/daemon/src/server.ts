import Fastify from 'fastify'
import cors from '@fastify/cors'
import { homedir } from 'os'
import { join } from 'path'
import type { AedevDb } from '@aedev/core'
import { registerStatusRoutes } from './routes/status.js'
import { registerMissionRoutes } from './routes/missions.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerRepoRoutes } from './routes/repos.js'
import { registerIntakeRoutes } from './routes/intake.js'
import { registerGitHubRoutes } from './routes/github.js'
import { registerSseRoutes } from './routes/sse.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { MissionRunner } from './mission-runner.js'

export function createServer(
  db: AedevDb,
  startTime: Date = new Date(),
  stateDir: string = process.env['AEDEV_HOME'] ?? join(homedir(), '.aedev'),
) {
  const app = Fastify({ logger: false })
  app.register(cors, { origin: true })
  registerStatusRoutes(app, db, startTime)
  registerMissionRoutes(app, db)
  registerTaskRoutes(app, db)
  registerRepoRoutes(app, db)
  registerIntakeRoutes(app, db, stateDir)
  registerGitHubRoutes(app, db)
  registerSseRoutes(app, db)
  registerMemoryRoutes(app, db)
  app.get('/approvals', async () => ({ approvals: db.listApprovals() }))
  app.post<{ Params: { id: string } }>('/missions/:id/run', async (req, reply) => {
    try {
      const runner = new MissionRunner(db, { stateDir })
      return await runner.runMission(req.params.id)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })
  return app
}
