import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface CapTokenClaims {
  /** Token id; logged for audit. */
  tid: string
  /** Task that requested the push. */
  taskId: string
  /** Branch the token authorizes (exact match). */
  branch: string
  /** Actor (worker) the token is bound to. */
  actor: string
  /** Issued-at ms epoch. */
  iat: number
  /** Expiration ms epoch. Default ttl is 5 min per ADR-0010. */
  exp: number
}

function b64url(buf: Buffer): string { return buf.toString('base64url') }
function fromB64url(s: string): Buffer { return Buffer.from(s, 'base64url') }

export interface SignedCapToken {
  payload: CapTokenClaims
  encoded: string
}

export class CapTokenSigner {
  private readonly key: Buffer
  constructor(secret: string | Buffer) {
    this.key = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret
    if (this.key.length < 16) throw new Error('cap-token signer secret must be ≥ 16 bytes')
  }

  sign(input: { taskId: string; branch: string; actor: string; ttlMs?: number; now?: number }): SignedCapToken {
    const now = input.now ?? Date.now()
    const payload: CapTokenClaims = {
      tid: b64url(randomBytes(9)),
      taskId: input.taskId,
      branch: input.branch,
      actor: input.actor,
      iat: now,
      exp: now + (input.ttlMs ?? 5 * 60 * 1000),
    }
    const head = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'aedev-cap-push' })))
    const body = b64url(Buffer.from(JSON.stringify(payload)))
    const mac = createHmac('sha256', this.key).update(`${head}.${body}`).digest()
    return { payload, encoded: `${head}.${body}.${b64url(mac)}` }
  }
}

export type CapVerifyError =
  | 'malformed'
  | 'wrong_signature'
  | 'expired'
  | 'wrong_branch'
  | 'wrong_task'
  | 'wrong_actor'

export interface CapVerifyOpts {
  expectedTaskId: string
  expectedBranch: string
  expectedActor: string
  now?: number
}

export interface CapVerifyResult {
  ok: boolean
  claims?: CapTokenClaims
  error?: CapVerifyError
}

export class CapTokenVerifier {
  private readonly key: Buffer
  constructor(secret: string | Buffer) {
    this.key = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret
  }

  verify(token: string, opts: CapVerifyOpts): CapVerifyResult {
    const parts = token.split('.')
    if (parts.length !== 3) return { ok: false, error: 'malformed' }
    const [head, body, sig] = parts
    let payload: CapTokenClaims
    try {
      const h = JSON.parse(fromB64url(head).toString('utf8')) as { alg?: string; typ?: string }
      if (h.alg !== 'HS256' || h.typ !== 'aedev-cap-push') return { ok: false, error: 'malformed' }
      payload = JSON.parse(fromB64url(body).toString('utf8')) as CapTokenClaims
    } catch {
      return { ok: false, error: 'malformed' }
    }
    const expected = createHmac('sha256', this.key).update(`${head}.${body}`).digest()
    const actual = fromB64url(sig)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, error: 'wrong_signature' }
    }
    const now = opts.now ?? Date.now()
    if (now >= payload.exp) return { ok: false, claims: payload, error: 'expired' }
    if (opts.expectedTaskId !== payload.taskId) return { ok: false, claims: payload, error: 'wrong_task' }
    if (opts.expectedBranch !== payload.branch) return { ok: false, claims: payload, error: 'wrong_branch' }
    if (opts.expectedActor !== payload.actor) return { ok: false, claims: payload, error: 'wrong_actor' }
    return { ok: true, claims: payload }
  }
}
