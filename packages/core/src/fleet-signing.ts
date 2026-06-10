/**
 * v5 fleet request signing contract (ADR-0022/0023).
 *
 * Lives in @aedev/core because BOTH sides of the fleet protocol need the
 * exact same bytes: the coordinator (@aedev/daemon) verifies, the worker
 * agent (@aedev/runner) signs, and runner may not import from daemon
 * (dependency direction: daemon -> runner). One shared implementation
 * means signatures are byte-identical by construction instead of by a
 * duplicated-helper contract test.
 *
 * Every fleet request after registration is signed with the worker's
 * registered ed25519 key over the canonical JSON of { body, nonce, sentAt }.
 * Uses node:crypto only — no new dependencies, no child processes (GR#8).
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto'

/** DER prefix that turns a raw 32-byte ed25519 public key into an SPKI key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
/** DER prefix that turns a raw 32-byte ed25519 seed into a PKCS8 private key. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

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

/** Worker side: rebuild a signing key from its raw 32-byte hex seed. */
export function privateKeyFromRawHex(hex: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
}

/** Raw 32-byte lowercase hex of an ed25519 KeyObject (worker/test side). */
export function rawPublicKeyHex(publicKey: KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return Buffer.from(der).subarray(-32).toString('hex')
}

/** Raw 32-byte lowercase hex seed of an ed25519 private KeyObject. */
export function rawPrivateKeyHex(privateKey: KeyObject): string {
  const der = privateKey.export({ format: 'der', type: 'pkcs8' })
  return Buffer.from(der).subarray(-32).toString('hex')
}

/** One-shot provisioning helper for a new fleet worker identity. */
export function generateFleetKeyPairHex(): { publicKeyHex: string; privateKeyHex: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKeyHex: rawPublicKeyHex(publicKey), privateKeyHex: rawPrivateKeyHex(privateKey) }
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
