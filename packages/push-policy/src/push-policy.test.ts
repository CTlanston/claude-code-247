import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import { CapTokenSigner, CapTokenVerifier, PushPolicy } from './index.js'

const SECRET = 'push-policy-test-secret-32-bytes'
async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'push-policy-'))
  return { dir, log: new FileEventLog({ dir }) }
}
function mkPolicy(now?: () => Date) {
  const signer = new CapTokenSigner(SECRET)
  const verifier = new CapTokenVerifier(SECRET)
  return { signer, verifier, mk: async () => {
    const { log } = await mkLog()
    return { log, policy: new PushPolicy({ log, signer, verifier, now }) }
  } }
}

describe('push-policy · cap-token rejection cases (Stage E L1)', () => {
  const ctx = mkPolicy()

  it('case 1: expired token → denied with error=expired', async () => {
    const { log, policy } = await ctx.mk()
    const past = Date.now() - 10_000
    const token = ctx.signer.sign({ taskId: 't1', branch: 'feature/x', actor: 'worker.t1', ttlMs: 1000, now: past }).encoded
    const out = await policy.authorize({ taskId: 't1', branch: 'feature/x', actor: 'worker.t1', capToken: token })
    expect(out.allowed).toBe(false)
    expect(out.error).toBe('expired')
    const events = await toArray(log.read('t1'))
    expect(events.find((e) => e.kind === 'push.cap.denied')).toBeDefined()
  })

  it('case 2: wrong branch → denied with error=wrong_branch', async () => {
    const { policy } = await ctx.mk()
    const token = ctx.signer.sign({ taskId: 't2', branch: 'feature/a', actor: 'worker.t2' }).encoded
    const out = await policy.authorize({ taskId: 't2', branch: 'main', actor: 'worker.t2', capToken: token })
    expect(out.allowed).toBe(false)
    expect(out.error).toBe('wrong_branch')
  })

  it('case 3: wrong task → denied with error=wrong_task', async () => {
    const { policy } = await ctx.mk()
    const token = ctx.signer.sign({ taskId: 't3', branch: 'feature/x', actor: 'worker.t3' }).encoded
    const out = await policy.authorize({ taskId: 't_other', branch: 'feature/x', actor: 'worker.t3', capToken: token })
    expect(out.allowed).toBe(false)
    expect(out.error).toBe('wrong_task')
  })

  it('case 4: wrong signature → denied with error=wrong_signature', async () => {
    const { policy } = await ctx.mk()
    const attackerSigner = new CapTokenSigner('attackers-32-byte-secret-not-real')
    const token = attackerSigner.sign({ taskId: 't4', branch: 'feature/x', actor: 'worker.t4' }).encoded
    const out = await policy.authorize({ taskId: 't4', branch: 'feature/x', actor: 'worker.t4', capToken: token })
    expect(out.allowed).toBe(false)
    expect(out.error).toBe('wrong_signature')
  })

  it('case 5: wrong actor → denied with error=wrong_actor', async () => {
    const { policy } = await ctx.mk()
    const token = ctx.signer.sign({ taskId: 't5', branch: 'feature/x', actor: 'worker.t5' }).encoded
    const out = await policy.authorize({ taskId: 't5', branch: 'feature/x', actor: 'someone-else', capToken: token })
    expect(out.allowed).toBe(false)
    expect(out.error).toBe('wrong_actor')
  })
})

describe('push-policy · happy path + forbidden paths (Stage E L1)', () => {
  const ctx = mkPolicy()

  it('case 6: well-formed cap-token → allowed; events: requested + allowed', async () => {
    const { log, policy } = await ctx.mk()
    const token = policy.issueCapToken({ taskId: 't6', branch: 'feature/ok', actor: 'worker.t6' })
    const out = await policy.authorize({ taskId: 't6', branch: 'feature/ok', actor: 'worker.t6', capToken: token, paths: ['src/foo.ts'] })
    expect(out.allowed).toBe(true)
    const kinds = (await toArray(log.read('t6'))).map((e) => e.kind)
    expect(kinds).toEqual(['push.cap.requested', 'push.cap.allowed'])
  })

  it('case 7: forbidden path .env triggers denial BEFORE token verify', async () => {
    const { log, policy } = await ctx.mk()
    // Provide a deliberately invalid token to prove the forbidden-path
    // check runs first.
    const out = await policy.authorize({ taskId: 't7', branch: 'feature/x', actor: 'worker.t7', capToken: 'not-a-token', paths: ['.env.production'] })
    expect(out.allowed).toBe(false)
    expect(out.error).toBe('forbidden_path')
    const denial = (await toArray(log.read('t7'))).find((e) => e.kind === 'push.cap.denied')
    expect((denial!.payload as { reason: string }).reason).toBe('forbidden_path')
  })

  it('case 8: forbidden secrets/** glob matches nested path', async () => {
    const { policy } = await ctx.mk()
    const token = policy.issueCapToken({ taskId: 't8', branch: 'feature/x', actor: 'worker.t8' })
    const out = await policy.authorize({ taskId: 't8', branch: 'feature/x', actor: 'worker.t8', capToken: token, paths: ['secrets/db/prod.key'] })
    expect(out.allowed).toBe(false)
    expect(out.error).toBe('forbidden_path')
  })
})
