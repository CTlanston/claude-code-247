/**
 * v5-P2 fleet request signing (ADR-0022/0023).
 *
 * The canonical-JSON ed25519 contract moved to @aedev/core (fleet-signing.ts)
 * so the worker side (@aedev/runner FleetWorkerAgent) and this coordinator
 * share ONE implementation — runner may not import from daemon, and a
 * duplicated helper would need a byte-identity contract test forever.
 * This module stays as the daemon's stable import path.
 */
export {
  canonicalJson,
  fleetMessage,
  isRawEd25519Hex,
  publicKeyFromRawHex,
  privateKeyFromRawHex,
  rawPublicKeyHex,
  rawPrivateKeyHex,
  generateFleetKeyPairHex,
  signFleetMessage,
  verifyFleetSignature,
} from '@aedev/core'
