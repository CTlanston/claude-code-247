/**
 * v5-P2 BYO-worker fleet routes (ADR-0022/0023, WORKBOOK v5 proposal §P2).
 *
 *   POST /fleet/register   public-key registration (the only unsigned call)
 *   POST /fleet/claim      pull-based task assignment (idempotent per nonce)
 *   POST /fleet/heartbeat  liveness; silence > 10min makes claims reclaimable
 *   POST /fleet/events     batch evidence ingestion, registry-bound identity
 *   POST /fleet/evidence   gate self-report (reference only — CI is the anchor)
 *   GET  /fleet/overview   v5-P3 read-only squad view (owner's local cockpit)
 *
 * The coordinator only hands out task descriptions and evidence requirements;
 * it never sends or stores credentials, and rejects any payload that carries
 * credential-shaped fields (red line, ADR-0022).
 */
import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'
import { authenticateFleetRequest, findCredentialField, systemClock, type FleetClock } from '../fleet/auth.js'
import { isRawEd25519Hex } from '../fleet/signing.js'
import { claimTask } from '../fleet/claims.js'
import { buildFleetOverview, fleetBudgetSessionKey } from '../fleet/overview.js'
import { checkHeadlessBudget, createBudgetHold, HOLD_BUDGET_CODE } from '../headless-budget-guard.js'

export interface FleetRouteOptions {
  /** Injectable clock for skew/heartbeat windows (tests use a fake clock). */
  clock?: FleetClock
}

interface RegisterBody { workerId?: string; operatorId?: string; publicKey?: string }
interface IngestEvent { type?: string; entityType?: string; entityId?: string; payload?: Record<string, unknown> }
interface EventsBody { events?: IngestEvent[] }
interface EvidenceBody { taskId?: string; selfReport?: { gates?: Record<string, boolean> } }

export function registerFleetRoutes(app: FastifyInstance, db: AedevDb, options: FleetRouteOptions = {}): void {
  const clock = options.clock ?? systemClock

  app.post<{ Body: RegisterBody }>('/fleet/register', async (req, reply) => {
    const body = req.body ?? {}
    const credField = findCredentialField(body)
    if (credField) {
      db.insertEvent('fleet.rejected_event', 'fleet_worker', body.workerId ?? 'unknown',
        { endpoint: '/fleet/register', reason: `credential_field_forbidden:${credField}` })
      return reply.code(400).send({ error: 'credential_field_forbidden', field: credField })
    }
    if (!body.workerId || !body.operatorId || !body.publicKey) {
      return reply.code(400).send({ error: 'workerId, operatorId and publicKey are required' })
    }
    if (!isRawEd25519Hex(body.publicKey)) {
      return reply.code(400).send({ error: 'publicKey must be a raw 32-byte ed25519 key in hex' })
    }
    const publicKey = body.publicKey.toLowerCase()
    const existing = db.getFleetWorker(body.workerId)
    if (existing) {
      // Idempotent re-register with the identical identity; anything else is
      // a key/operator takeover attempt and is refused (ADR-0022).
      if (existing.publicKey === publicKey && existing.operatorId === body.operatorId) {
        return { workerId: existing.workerId, operatorId: existing.operatorId, status: existing.status }
      }
      return reply.code(409).send({ error: 'worker_exists' })
    }
    const worker = db.insertFleetWorker({ workerId: body.workerId, operatorId: body.operatorId, publicKey })
    db.insertEvent('fleet.worker_registered', 'fleet_worker', worker.workerId,
      { operatorId: worker.operatorId }, worker.operatorId)
    return { workerId: worker.workerId, operatorId: worker.operatorId, status: worker.status }
  })

  app.post('/fleet/claim', async (req, reply) => {
    const auth = authenticateFleetRequest(db, req.headers, req.body ?? {}, clock,
      { endpoint: '/fleet/claim', allowNonceReplayResponse: true })
    if (!auth.ok) return reply.code(auth.status).send({ error: auth.code })
    if (auth.replayResponse !== undefined) {
      // Idempotent claim: a retried (workerId, nonce) gets the original answer.
      return reply.send(JSON.parse(auth.replayResponse))
    }
    // v5-P3 per-operator budget gate: an over-budget operator's worker is
    // refused BEFORE any task is assigned — 429 plus exactly one active
    // HOLD-BUDGET on the operator's fleet budget session (`fleet:<op>`).
    const sessionKey = fleetBudgetSessionKey(auth.worker.operatorId)
    const verdict = checkHeadlessBudget(db, sessionKey, new Date(clock.now()), auth.worker.operatorId)
    if (!verdict.allowed) {
      const reason = createBudgetHold(db, sessionKey, verdict)
      return reply.code(429).send({ error: 'budget_exceeded', holdCode: HOLD_BUDGET_CODE, reason })
    }
    const result = claimTask(db, auth.worker, auth.nonce, clock)
    const response = { task: result.task }
    db.saveFleetNonceResponse(auth.worker.workerId, auth.nonce, JSON.stringify(response))
    return response
  })

  app.post('/fleet/heartbeat', async (req, reply) => {
    const auth = authenticateFleetRequest(db, req.headers, req.body ?? {}, clock, { endpoint: '/fleet/heartbeat' })
    if (!auth.ok) return reply.code(auth.status).send({ error: auth.code })
    const lastSeenAt = new Date(clock.now()).toISOString()
    db.touchFleetWorker(auth.worker.workerId, lastSeenAt)
    return { ok: true, lastSeenAt }
  })

  app.post<{ Body: EventsBody }>('/fleet/events', async (req, reply) => {
    const auth = authenticateFleetRequest(db, req.headers, req.body ?? {}, clock, { endpoint: '/fleet/events' })
    if (!auth.ok) return reply.code(auth.status).send({ error: auth.code })
    const events = req.body?.events
    if (!Array.isArray(events) || events.length === 0 || events.some((e) => typeof e?.type !== 'string' || e.type.length === 0)) {
      return reply.code(400).send({ error: 'events must be a non-empty array of { type, entityType?, entityId?, payload? }' })
    }
    // Identity comes from the registry binding, NEVER from the payload: a
    // worker cannot speak for another operator (ADR-0023 provenance rule).
    let ingested = 0
    for (const e of events) {
      db.insertEvent(
        e.type as string, e.entityType, e.entityId,
        { ...(e.payload ?? {}), workerId: auth.worker.workerId },
        auth.worker.operatorId,
      )
      ingested++
    }
    return { ingested }
  })

  // v5-P3 read-only squad view: who is running what + per-operator credit
  // counts and holds. No auth headers — this is the owner's local cockpit.
  // Derived entirely from existing events/tables (GR#5); exposes no write
  // actions and no key material.
  app.get('/fleet/overview', async () => buildFleetOverview(db, clock))

  app.post<{ Body: EvidenceBody }>('/fleet/evidence', async (req, reply) => {
    const auth = authenticateFleetRequest(db, req.headers, req.body ?? {}, clock, { endpoint: '/fleet/evidence' })
    if (!auth.ok) return reply.code(auth.status).send({ error: auth.code })
    const { taskId, selfReport } = req.body ?? {}
    if (!taskId || !selfReport || typeof selfReport !== 'object') {
      return reply.code(400).send({ error: 'taskId and selfReport are required' })
    }
    // Reference evidence only — the CI-on-PR result stays the single trust
    // anchor; detectEvidenceMismatch() compares the two when CI lands.
    db.insertEvent('fleet.evidence_reported', 'task', taskId,
      { workerId: auth.worker.workerId, selfReport }, auth.worker.operatorId)
    return { ok: true }
  })
}
