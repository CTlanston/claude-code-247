import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'

export function registerRepoRoutes(app: FastifyInstance, db: AedevDb): void {
  app.get('/repos', async () => ({ repos: db.listRepos() }))
}
