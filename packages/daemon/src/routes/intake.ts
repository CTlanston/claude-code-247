import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'
import { AutonomousIntakeService } from '../autonomous-intake.js'
import { IntakeService } from '../intake.js'
import { ApprovalGate } from '../approval.js'

export function registerIntakeRoutes(app: FastifyInstance, db: AedevDb, stateDir: string): void {
  const intake = new IntakeService(db, stateDir)
  const gate = new ApprovalGate(db)
  // gate is used for listing pending approvals in future routes
  void gate

  app.post<{ Body: { repoId?: string; description: string; title?: string } }>('/intake', async (req, reply) => {
    const { repoId = 'unknown', description, title } = req.body
    if (!description) return reply.code(400).send({ error: 'description is required' })
    const mission = intake.createMissionCandidate(repoId, description, title)
    return { missionId: mission.id, status: mission.status, prdPath: intake.getPrdPath(mission.id) }
  })

  app.post<{ Body: { repoId?: string; capPerRepo?: number } }>('/intake/scan', async (req) => {
    const service = new AutonomousIntakeService(db, stateDir, {
      capPerRepo: req.body?.capPerRepo,
    })
    return await service.scan({ repoId: req.body?.repoId })
  })

  app.post<{ Body: { repoId?: string; idea: string; title?: string } }>('/brainstorm', async (req, reply) => {
    const { repoId = 'unknown', idea, title } = req.body
    if (!idea) return reply.code(400).send({ error: 'idea is required' })
    const mission = intake.createMissionCandidate(repoId, idea, title)
    return {
      missionId: mission.id,
      status: mission.status,
      prdPath: intake.getPrdPath(mission.id),
      design: intake.getDesign(mission.id),
    }
  })

  app.post<{ Params: { id: string }; Body: { by?: string } }>('/missions/:id/approve', async (req, reply) => {
    try {
      const mission = intake.approveMission(req.params.id, req.body.by ?? 'operator')
      return mission
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/missions/:id/request-approval', async (req, reply) => {
    try {
      const mission = intake.requestApproval(req.params.id)
      return mission
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.get<{ Params: { id: string } }>('/missions/:id/can-execute', async (req) => ({
    canExecute: intake.canExecute(req.params.id),
  }))

  app.get<{ Params: { id: string } }>('/missions/:id/prd', async (req, reply) => {
    const content = intake.getPrdContent(req.params.id)
    if (!content) return reply.code(404).send({ error: 'PRD not found' })
    return { content }
  })

  app.get<{ Params: { id: string } }>('/missions/:id/design', async (req, reply) => {
    const design = intake.getDesign(req.params.id)
    if (!design) return reply.code(404).send({ error: 'Mission design not found' })
    return design
  })
}
