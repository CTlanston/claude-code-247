import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  canonicalJson,
  fleetMessage,
  generateFleetKeyPairHex,
  isRawEd25519Hex,
  privateKeyFromRawHex,
  rawPrivateKeyHex,
  rawPublicKeyHex,
  signFleetMessage,
  verifyFleetSignature,
} from './fleet-signing.js'

describe('fleet-signing — shared worker/coordinator contract (@aedev/core)', () => {
  it('canonicalJson is key-order independent and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 3, e: 4 }], c: null, skip: undefined } }))
      .toBe(canonicalJson({ a: { c: null, d: [2, { e: 4, f: 3 }] }, b: 1 }))
    expect(fleetMessage({ x: 1 }, 'n1', 't1')).toBe('{"body":{"x":1},"nonce":"n1","sentAt":"t1"}')
  })

  it('generateFleetKeyPairHex produces raw hex keys that sign and verify round-trip', () => {
    const { publicKeyHex, privateKeyHex } = generateFleetKeyPairHex()
    expect(isRawEd25519Hex(publicKeyHex)).toBe(true)
    expect(isRawEd25519Hex(privateKeyHex)).toBe(true)
    const sig = signFleetMessage(privateKeyFromRawHex(privateKeyHex), { hello: 1 }, 'nonce-1', '2026-06-10T00:00:00.000Z')
    expect(verifyFleetSignature(publicKeyHex, { hello: 1 }, 'nonce-1', '2026-06-10T00:00:00.000Z', sig)).toBe(true)
    // tampered body / wrong key both fail
    expect(verifyFleetSignature(publicKeyHex, { hello: 2 }, 'nonce-1', '2026-06-10T00:00:00.000Z', sig)).toBe(false)
    expect(verifyFleetSignature(generateFleetKeyPairHex().publicKeyHex, { hello: 1 }, 'nonce-1', '2026-06-10T00:00:00.000Z', sig)).toBe(false)
  })

  it('raw hex extraction round-trips through node KeyObjects (worker provisioning path)', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pubHex = rawPublicKeyHex(publicKey)
    const privHex = rawPrivateKeyHex(privateKey)
    const sig = signFleetMessage(privateKeyFromRawHex(privHex), { v: 'x' }, 'n', 't')
    expect(verifyFleetSignature(pubHex, { v: 'x' }, 'n', 't', sig)).toBe(true)
  })

  it('a signature produced by one JSON serialization verifies against a re-parsed body (wire independence)', () => {
    const { publicKeyHex, privateKeyHex } = generateFleetKeyPairHex()
    const body = { z: 1, a: { m: [1, 2], k: 'v' } }
    const sig = signFleetMessage(privateKeyFromRawHex(privateKeyHex), body, 'n', 't')
    const reparsed = JSON.parse('{"a":{"k":"v","m":[1,2]},"z":1}') as unknown
    expect(verifyFleetSignature(publicKeyHex, reparsed, 'n', 't', sig)).toBe(true)
  })
})
