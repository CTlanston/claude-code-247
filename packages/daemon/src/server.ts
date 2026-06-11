import Fastify from 'fastify'
import cors from '@fastify/cors'
import type { AedevDb } from '@aedev/core'
import { registerStatusRoutes } from './routes/status.js'
import { registerMissionRoutes } from './routes/missions.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerRepoRoutes } from './routes/repos.js'
import { registerIntakeRoutes } from './routes/intake.js'
import { registerGitHubRoutes } from './routes/github.js'
import { registerSseRoutes } from './routes/sse.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerSmokeRoutes } from './routes/smoke.js'
import { registerOperatorRoutes } from './routes/operator.js'
import type { OperatorRouteOptions } from './routes/operator.js'
import { registerApprovalRoutes } from './routes/approvals.js'
import { registerFleetRoutes } from './routes/fleet.js'
import { registerOpsRoutes } from './routes/ops.js'
import { MissionRunner } from './mission-runner.js'
import { discoverWorkerSessions } from '@aedev/runner'
import { resolveStateDir } from './paths.js'
import { createDefaultMissionValidatorFactory } from './validator-factory.js'
import { recordDiscoveryProbe } from './headless-budget-guard.js'
import type { CostRoller } from '@aedev/cost-meter'

export function createServer(
  db: AedevDb,
  startTime: Date = new Date(),
  stateDir: string = resolveStateDir(),
  operatorOptions: OperatorRouteOptions = {},
  costRoller?: CostRoller,
) {
  const app = Fastify({ logger: false })
  app.register(cors, { origin: true })
  registerStatusRoutes(app, db, startTime)
  registerMissionRoutes(app, db)
  registerTaskRoutes(app, db)
  registerRepoRoutes(app, db)
  registerIntakeRoutes(app, db, stateDir)
  registerGitHubRoutes(app, db, stateDir)
  registerSseRoutes(app, db)
  registerMemoryRoutes(app, db)
  registerSmokeRoutes(app, db, costRoller)
  registerOperatorRoutes(app, db, stateDir, operatorOptions)
  registerApprovalRoutes(app, db, stateDir)
  registerFleetRoutes(app, db) // v5-P2 BYO-worker fleet (real wall clock)
  registerOpsRoutes(app, db, stateDir) // cloudhull-c6 owner Operations view (events-only, no probes)
  app.post<{ Params: { id: string } }>('/missions/:id/run', async (req, reply) => {
    try {
      const workerSessions = await discoverWorkerSessions()
      recordDiscoveryProbe(db, null, workerSessions)
      const runner = new MissionRunner(db, {
        stateDir,
        workerSessions,
        validatorFactory: createDefaultMissionValidatorFactory(),
      })
      return await runner.runMission(req.params.id)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })
  return app
}
