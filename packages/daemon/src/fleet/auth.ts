/**
 * v5-P2 fleet request authentication (ADR-0022 threat model).
 *
 * Workers are zero-trust endpoints: every request after registration must
 * carry x-worker-id / x-nonce / x-sent-at / x-signature. Rejections are
 * evidence too — each one appends a `fleet.rejected_event`.
 *
 * The nonce ledger lives in SQLite (fleet_nonces), not in process memory,
 * so replay protection survives daemon restarts (GR#5: state is the DB).
 */
import type { AedevDb, FleetWorker } from '@aedev/core'
import { verifyFleetSignature } from './signing.js'

/** Injectable clock so timeout behaviour is testable without real waiting. */
export interface FleetClock { now(): number }
export const systemClock: FleetClock = { now: () => Date.now() }

/** Max |now - sentAt| before a signed request is considered a replay risk. */
export const MAX_SENT_AT_SKEW_MS = 5 * 60 * 1000
/** A claim held by a worker silent for longer than this becomes reclaimable. */
export const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000

/** RED LINE (ADR-0022): fleet payloads must never carry credentials. */
const CREDENTIAL_FIELD_RE = /token|api[_-]?key|secret/i

/** Returns the dotted path of the first credential-shaped field, if any. */
export function findCredentialField(value: unknown, path = ''): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findCredentialField(value[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return undefined
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k
    if (CREDENTIAL_FIELD_RE.test(k)) return p
    const nested = findCredentialField(v, p)
    if (nested) return nested
  }
  return undefined
}

export type FleetAuthResult =
  | { ok: true; worker: FleetWorker; nonce: string; sentAt: string; replayResponse?: string }
  | { ok: false; status: number; code: string }

export interface FleetAuthOptions {
  endpoint: string
  /** Idempotent endpoints (claim) replay their cached response instead of 401ing. */
  allowNonceReplayResponse?: boolean
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name]
  return Array.isArray(v) ? v[0] : v
}

function reject(
  db: AedevDb, endpoint: string, workerId: string, reason: string,
  status: number, code: string, operatorId = 'owner',
): FleetAuthResult {
  db.insertEvent('fleet.rejected_event', 'fleet_worker', workerId || 'unknown', { endpoint, reason }, operatorId)
  return { ok: false, status, code }
}

export function authenticateFleetRequest(
  db: AedevDb,
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
  clock: FleetClock,
  opts: FleetAuthOptions,
): FleetAuthResult {
  const workerId = headerValue(headers, 'x-worker-id')
  const nonce = headerValue(headers, 'x-nonce')
  const sentAt = headerValue(headers, 'x-sent-at')
  const signature = headerValue(headers, 'x-signature')
  if (!workerId || !nonce || !sentAt || !signature) {
    return reject(db, opts.endpoint, workerId ?? '', 'missing_auth_headers', 401, 'missing_auth_headers')
  }
  const worker = db.getFleetWorker(workerId)
  if (!worker) {
    return reject(db, opts.endpoint, workerId, 'unknown_worker', 401, 'unknown_worker')
  }
  const sentAtMs = Date.parse(sentAt)
  if (!Number.isFinite(sentAtMs) || Math.abs(clock.now() - sentAtMs) > MAX_SENT_AT_SKEW_MS) {
    return reject(db, opts.endpoint, workerId, 'stale_sent_at', 401, 'stale_sent_at', worker.operatorId)
  }
  if (!verifyFleetSignature(worker.publicKey, body, nonce, sentAt, signature)) {
    return reject(db, opts.endpoint, workerId, 'bad_signature', 401, 'bad_signature', worker.operatorId)
  }
  const credField = findCredentialField(body)
  if (credField) {
    return reject(db, opts.endpoint, workerId, `credential_field_forbidden:${credField}`, 400, 'credential_field_forbidden', worker.operatorId)
  }
  if (worker.status === 'frozen') {
    return reject(db, opts.endpoint, workerId, 'worker_frozen', 403, 'worker_frozen', worker.operatorId)
  }
  const existing = db.getFleetNonce(workerId, nonce)
  if (existing) {
    if (opts.allowNonceReplayResponse && existing.responseJson !== undefined) {
      return { ok: true, worker, nonce, sentAt, replayResponse: existing.responseJson }
    }
    return reject(db, opts.endpoint, workerId, 'replayed_nonce', 401, 'replayed_nonce', worker.operatorId)
  }
  db.recordFleetNonce(workerId, nonce, opts.endpoint)
  return { ok: true, worker, nonce, sentAt }
}
