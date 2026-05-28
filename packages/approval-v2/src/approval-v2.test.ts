import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import {
  ApprovalGateway,
  DispatchTransport,
  TailscaleTransport,
  TokenSigner,
  TokenVerifier,
} from './index.js'

const SECRET = 'a-very-strong-test-secret-for-hs256'

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-v2-'))
  return { dir, log: new FileEventLog({ dir }) }
}

describe('approval-v2 · token (Stage D L1)', () => {
  const signer = new TokenSigner(SECRET)
  const verifier = new TokenVerifier(SECRET)

  it('case 1: round-trip — verify accepts a freshly signed token', () => {
    const tok = signer.sign({
      approvalId: 'appr_1', taskId: 'task_d', actor: 'lanston',
      decision: 'approve', ttlMs: 5 * 60 * 1000,
    })
    const r = verifier.verify(tok.encoded)
    expect(r.ok).toBe(true)
    expect(r.claims?.decision).toBe('approve')
  })

  it('case 2: tamper — flipping a signature byte fails verification', () => {
    const tok = signer.sign({
      approvalId: 'appr_2', taskId: 'task_d', actor: 'lanston',
      decision: 'approve', ttlMs: 5 * 60 * 1000,
    })
    const parts = tok.encoded.split('.')
    // Flip a char in the signature segment — payload still decodes cleanly,
    // signature comparison fails deterministically.
    const firstChar = parts[2].charAt(0)
    const swap = firstChar === 'A' ? 'B' : 'A'
    const tampered = swap + parts[2].slice(1)
    const r = verifier.verify(`${parts[0]}.${parts[1]}.${tampered}`)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('signature_mismatch')
  })

  it('case 3: expired — verify rejects when now ≥ exp', () => {
    const tok = signer.sign({
      approvalId: 'appr_3', taskId: 'task_d', actor: 'lanston',
      decision: 'approve', ttlMs: 1000, now: 1_000_000,
    })
    const r = verifier.verify(tok.encoded, { now: 1_000_000 + 2000 })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('expired')
  })

  it('case 4: replay — same nonce rejected on second verify', () => {
    const tok = signer.sign({
      approvalId: 'appr_4', taskId: 'task_d', actor: 'lanston',
      decision: 'approve', ttlMs: 5 * 60 * 1000,
    })
    const seen = new Set<string>()
    expect(verifier.verify(tok.encoded, { seenNonces: seen }).ok).toBe(true)
    const second = verifier.verify(tok.encoded, { seenNonces: seen })
    expect(second.ok).toBe(false)
    expect(second.error).toBe('replay')
  })

  it('case 5: wrong-task rejection', () => {
    const tok = signer.sign({
      approvalId: 'appr_5', taskId: 'task_d', actor: 'lanston',
      decision: 'approve', ttlMs: 5 * 60 * 1000,
    })
    const r = verifier.verify(tok.encoded, { expectedTaskId: 'task_other' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('wrong_task')
  })
})

describe('approval-v2 · gateway dual-rail (Stage D L1)', () => {
  it('case 6: primary tailscale approves → event log records via=tailscale, no failover', async () => {
    const { log } = await mkLog()
    const signer = new TokenSigner(SECRET)
    const verifier = new TokenVerifier(SECRET)
    const primary = new TailscaleTransport(async (req) => ({
      decision: 'approve', token: req.approveToken,
    }))
    const fallback = new DispatchTransport(async (req) => ({
      decision: 'reject', token: req.rejectToken,
    }))
    const gw = new ApprovalGateway({ log, signer, verifier, primary, fallback })
    const out = await gw.request({ taskId: 'task_d', reason: 'merge_high_risk', operator: 'lanston' })
    expect(out.decision).toBe('approve')
    expect(out.via).toBe('tailscale')
    const events = await toArray(log.read('task_d'))
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('approval.request.emitted')
    expect(kinds).toContain('approval.decision.received')
    expect(kinds).not.toContain('approval.transport.failover')
  })

  it('case 7: primary unhealthy → gateway falls back to dispatch, emits failover event', async () => {
    const { log } = await mkLog()
    const signer = new TokenSigner(SECRET)
    const verifier = new TokenVerifier(SECRET)
    const primary = new TailscaleTransport(async () => {
      throw new Error('unreachable')
    })
    primary.setHealth(false)
    const fallback = new DispatchTransport(async (req) => ({
      decision: 'approve', token: req.approveToken,
    }))
    const gw = new ApprovalGateway({ log, signer, verifier, primary, fallback })
    const out = await gw.request({ taskId: 'task_d', reason: 'cap_token', operator: 'lanston' })
    expect(out.via).toBe('dispatch')
    expect(out.decision).toBe('approve')
    const events = await toArray(log.read('task_d'))
    expect(events.map((e) => e.kind)).toContain('approval.transport.failover')
  })

  it('case 8: reject path — gateway propagates a reject decision', async () => {
    const { log } = await mkLog()
    const signer = new TokenSigner(SECRET)
    const verifier = new TokenVerifier(SECRET)
    const primary = new TailscaleTransport(async (req) => ({
      decision: 'reject', token: req.rejectToken,
    }))
    const fallback = new DispatchTransport(async () => ({ decision: 'approve', token: '' }))
    const gw = new ApprovalGateway({ log, signer, verifier, primary, fallback })
    const out = await gw.request({ taskId: 'task_d', reason: 'forbidden_path', operator: 'lanston' })
    expect(out.decision).toBe('reject')
    expect(out.via).toBe('tailscale')
  })

  it('case 9: forged token from a different secret is rejected at gateway boundary', async () => {
    const { log } = await mkLog()
    const signer = new TokenSigner(SECRET)
    const verifier = new TokenVerifier(SECRET)
    // attacker forges a token with their own secret
    const attackerSigner = new TokenSigner('the-attackers-secret-not-real-aedev')
    const forged = attackerSigner.sign({
      approvalId: 'appr_x', taskId: 'task_d', actor: 'lanston',
      decision: 'approve', ttlMs: 5 * 60 * 1000,
    }).encoded
    const primary = new TailscaleTransport(async () => ({ decision: 'approve', token: forged }))
    const fallback = new DispatchTransport(async () => ({ decision: 'approve', token: forged }))
    const gw = new ApprovalGateway({ log, signer, verifier, primary, fallback })
    await expect(gw.request({ taskId: 'task_d', reason: 'audit', operator: 'lanston' })).rejects.toThrow(/signature_mismatch/)
  })
})
