import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface ApprovalTokenClaims {
  /** Approval request id this token authorizes. */
  approvalId: string
  /** Task the approval is for. */
  taskId: string
  /** Operator identifier (Tailscale ACL handle or ntfy topic). */
  actor: string
  /** Permitted decision: 'approve' | 'reject'. */
  decision: 'approve' | 'reject'
  /** Issued-at ms since epoch. */
  iat: number
  /** Expiration ms since epoch. */
  exp: number
  /** Single-use nonce. */
  nonce: string
}

export interface SignedToken {
  payload: ApprovalTokenClaims
  /** Base64url string of the entire signed token. */
  encoded: string
}

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

export class TokenSigner {
  private readonly key: Buffer
  constructor(secret: string | Buffer) {
    this.key = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret
    if (this.key.length < 16) {
      throw new Error('TokenSigner secret must be at least 16 bytes for HMAC-SHA256')
    }
  }

  sign(claims: Omit<ApprovalTokenClaims, 'nonce' | 'iat' | 'exp'> & { ttlMs: number; now?: number }): SignedToken {
    const now = claims.now ?? Date.now()
    const payload: ApprovalTokenClaims = {
      approvalId: claims.approvalId,
      taskId: claims.taskId,
      actor: claims.actor,
      decision: claims.decision,
      iat: now,
      exp: now + claims.ttlMs,
      nonce: b64url(randomBytes(12)),
    }
    const headerB64 = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'aedev-approval' })))
    const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
    const mac = createHmac('sha256', this.key).update(`${headerB64}.${payloadB64}`).digest()
    const sigB64 = b64url(mac)
    const encoded = `${headerB64}.${payloadB64}.${sigB64}`
    return { payload, encoded }
  }
}

export type VerifyError =
  | 'malformed'
  | 'signature_mismatch'
  | 'expired'
  | 'replay'
  | 'wrong_task'
  | 'wrong_approval'

export interface VerifyResult {
  ok: boolean
  claims?: ApprovalTokenClaims
  error?: VerifyError
}

export interface VerifyOpts {
  expectedApprovalId?: string
  expectedTaskId?: string
  now?: number
  /** Set of nonces already seen — verifier rejects on replay. */
  seenNonces?: Set<string>
}

export class TokenVerifier {
  private readonly key: Buffer
  constructor(secret: string | Buffer) {
    this.key = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret
  }

  verify(token: string, opts: VerifyOpts = {}): VerifyResult {
    const parts = token.split('.')
    if (parts.length !== 3) return { ok: false, error: 'malformed' }
    const [headerB64, payloadB64, sigB64] = parts
    let payload: ApprovalTokenClaims
    try {
      const headerStr = fromB64url(headerB64).toString('utf8')
      const header = JSON.parse(headerStr) as { alg: string; typ: string }
      if (header.alg !== 'HS256' || header.typ !== 'aedev-approval') {
        return { ok: false, error: 'malformed' }
      }
      payload = JSON.parse(fromB64url(payloadB64).toString('utf8')) as ApprovalTokenClaims
    } catch {
      return { ok: false, error: 'malformed' }
    }
    const expected = createHmac('sha256', this.key).update(`${headerB64}.${payloadB64}`).digest()
    const actual = fromB64url(sigB64)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, error: 'signature_mismatch' }
    }
    const now = opts.now ?? Date.now()
    if (now >= payload.exp) return { ok: false, claims: payload, error: 'expired' }
    if (opts.expectedTaskId && opts.expectedTaskId !== payload.taskId) {
      return { ok: false, claims: payload, error: 'wrong_task' }
    }
    if (opts.expectedApprovalId && opts.expectedApprovalId !== payload.approvalId) {
      return { ok: false, claims: payload, error: 'wrong_approval' }
    }
    if (opts.seenNonces?.has(payload.nonce)) {
      return { ok: false, claims: payload, error: 'replay' }
    }
    opts.seenNonces?.add(payload.nonce)
    return { ok: true, claims: payload }
  }
}
