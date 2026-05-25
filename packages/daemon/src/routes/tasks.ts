import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'

export function registerTaskRoutes(app: FastifyInstance, db: AedevDb): void {
  app.get('/tasks', async () => ({ tasks: db.listTasks() }))

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const t = db.getTask(req.params.id)
    if (!t) return reply.code(404).send({ error: 'Not found' })
    return t
  })
}
