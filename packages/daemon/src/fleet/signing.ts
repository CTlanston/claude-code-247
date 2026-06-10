/**
 * v5-P2 fleet request signing (ADR-0022/0023).
 *
 * Every fleet request after registration is signed with the worker's
 * registered ed25519 key over the canonical JSON of { body, nonce, sentAt }.
 * Uses node:crypto only — no new dependencies, no child processes (GR#8).
 */
import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

/** DER prefix that turns a raw 32-byte ed25519 public key into an SPKI key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace,
 * `undefined` members dropped. Signature stability does not depend on the
 * serializer the worker used on the wire.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** The exact byte string a worker signs: canonical JSON of body+nonce+sentAt. */
export function fleetMessage(body: unknown, nonce: string, sentAt: string): string {
  return canonicalJson({ body, nonce, sentAt })
}

export function isRawEd25519Hex(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s)
}

export function publicKeyFromRawHex(hex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  })
}

/** Raw 32-byte lowercase hex of an ed25519 KeyObject (worker/test side). */
export function rawPublicKeyHex(publicKey: KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return Buffer.from(der).subarray(-32).toString('hex')
}

/** Worker/test side: produce the hex signature for the x-signature header. */
export function signFleetMessage(privateKey: KeyObject, body: unknown, nonce: string, sentAt: string): string {
  return sign(null, Buffer.from(fleetMessage(body, nonce, sentAt), 'utf8'), privateKey).toString('hex')
}

/** Coordinator side: verify against the registered raw-hex public key. */
export function verifyFleetSignature(
  publicKeyHex: string,
  body: unknown,
  nonce: string,
  sentAt: string,
  signatureHex: string,
): boolean {
  if (!isRawEd25519Hex(publicKeyHex) || !/^[0-9a-f]+$/i.test(signatureHex)) return false
  try {
    return verify(
      null,
      Buffer.from(fleetMessage(body, nonce, sentAt), 'utf8'),
      publicKeyFromRawHex(publicKeyHex),
      Buffer.from(signatureHex, 'hex'),
    )
  } catch {
    return false
  }
}
