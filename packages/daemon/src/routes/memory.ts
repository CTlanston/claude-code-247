import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'
import { MemoryCompiler } from '../memory/memory-compiler.js'

export function registerMemoryRoutes(app: FastifyInstance, db: AedevDb): void {
  app.get('/memory', async (req) => {
    const url = new URL(req.url, 'http://localhost')
    const approved = url.searchParams.get('approved')
    const filters = approved !== null ? { approved: approved === 'true' } : {}
    return { items: db.listMemoryItems(filters) }
  })

  app.post<{ Params: { id: string } }>('/memory/:id/approve', async (req, reply) => {
    try {
      db.approveMemoryItem(req.params.id)
      return { ok: true }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.post<{ Body: { title: string; content: string; type?: string } }>('/memory', async (req, reply) => {
    try {
      const item = db.insertMemoryItem({
        type: req.body.type ?? 'decision',
        title: req.body.title,
        content: req.body.content,
        approved: false,
      })
      return item
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.post('/memory/scan', async () => {
    const compiler = new MemoryCompiler(db)
    const created = compiler.scanAndCompile()
    return { created: created.length, items: created }
  })
}
