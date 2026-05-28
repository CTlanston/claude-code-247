import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'

export function registerSseRoutes(app: FastifyInstance, db: AedevDb): void {
  app.get('/events/stream', (req, reply) => {
    reply.hijack()
    const raw = reply.raw
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('Access-Control-Allow-Origin', '*')
    raw.flushHeaders?.()

    const send = (event: string, data: unknown) => {
      try { raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
      catch { /* client disconnected */ }
    }

    send('connected', { ts: new Date().toISOString() })
    for (const event of db.queryEvents({ limit: 100 })) {
      send('event', { id: event.id, kind: event.type, payload: event.payload })
    }
    const url = new URL(req.url, 'http://localhost')
    if (url.searchParams.get('from') === 'tail-100') {
      raw.end()
      return
    }

    const timer = setInterval(() => {
      try {
        send('state', {
          missions: db.listMissions(),
          tasks: db.listTasks(),
          pendingApprovals: db.listApprovals('pending').length,
        })
      } catch { clearInterval(timer) }
    }, 2_000)

    raw.once('close', () => clearInterval(timer))
    raw.once('error', () => clearInterval(timer))
  })
}
