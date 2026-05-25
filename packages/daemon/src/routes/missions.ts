import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'

export function registerMissionRoutes(app: FastifyInstance, db: AedevDb): void {
  app.get('/missions', async () => ({ missions: db.listMissions() }))

  app.get<{ Params: { id: string } }>('/missions/:id', async (req, reply) => {
    const m = db.getMission(req.params.id)
    if (!m) return reply.code(404).send({ error: 'Not found' })
    return m
  })

  app.post<{ Params: { id: string }; Body: { status: string } }>('/missions/:id/status', async (req, reply) => {
    const m = db.getMission(req.params.id)
    if (!m) return reply.code(404).send({ error: 'Not found' })
    db.updateMissionStatus(req.params.id, req.body.status)
    db.insertEvent('mission.status_changed', 'mission', req.params.id, { from: m.status, to: req.body.status })
    return db.getMission(req.params.id)
  })
}
