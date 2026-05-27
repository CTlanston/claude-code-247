import Fastify, { type FastifyInstance } from 'fastify'
import { buildStatusBoard, type StatusBoardInput } from './status-board.js'

export interface DashboardServerOpts {
  /** Function the daemon plugs in; returns a snapshot for the board. */
  snapshot: () => StatusBoardInput
  /** Wall-clock injection for tests. */
  now?: () => Date
}

/**
 * Stage F2 Fastify dashboard. Mounts /status-board.json (the contract
 * surface byte-equal vs the legacy Flask dashboard, modulo
 * generated_at) and a simple /health probe.
 *
 * The actual HTMX page is served as a static file by the operator's
 * install step; this server is the JSON + health control plane.
 */
export function buildDashboardServer(opts: DashboardServerOpts): FastifyInstance {
  const now = opts.now ?? (() => new Date())
  const fastify = Fastify({ logger: false })

  fastify.get('/health', async () => ({ ok: true, ts: now().toISOString() }))

  fastify.get('/status-board.json', async (_req, reply) => {
    const board = buildStatusBoard(opts.snapshot(), now().toISOString())
    reply.header('content-type', 'application/json')
    return board
  })

  return fastify
}
