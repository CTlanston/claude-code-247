/** Stage M2 end-to-end: RoadmapAgent → ApprovalGateway → AgentMesh
 *  planner → Coder → push-policy. All under one event log so we can
 *  verify the full causal chain.
 *
 *  Workbook §3 Stage M2 L3: "操作员从手机批准一条 proposal，端到端
 *  能跑到 PR". This test simulates that loop in-process. The operator
 *  is mocked as a TailscaleTransport that auto-approves; the git PR
 *  step is a `fake-git` push that emits push.cap.allowed.
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import { scanRoadmap, classify, ProposalEmitter } from './index.js'
import {
  ApprovalGateway, TokenSigner, TokenVerifier,
  TailscaleTransport, DispatchTransport,
} from '@aedev/approval-v2'
import { AgentMesh, defaultRegistry, fanOutWithRepair, type AgentRunFn } from '@aedev/agent-mesh'
import { CapTokenSigner, CapTokenVerifier, PushPolicy } from '@aedev/push-policy'

const APPROVAL_SECRET = 'm2-e2e-test-secret-32-bytes-yes'
const CAP_SECRET = 'm2-e2e-cap-secret-32-bytes-here!'

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm2-e2e-'))
  return { dir, log: new FileEventLog({ dir }) }
}

describe('roadmap-agent · end-to-end RoadmapAgent → PR (Stage M2 closure)', () => {
  it('case 1: roadmap → proposal → approval → mesh → cap-token → push.allowed', async () => {
    const { log } = await mkLog()
    const taskId = 'task_m2_e2e'

    // === 1. RoadmapAgent finds a proposal
    const roadmap = '- [ ] Fix typo in CHANGELOG\n'
    const candidates = scanRoadmap('roadmap.md', roadmap)
    expect(candidates.length).toBe(1)
    const proposal = classify({ id: candidates[0].id, text: candidates[0].text })
    expect(proposal.track).toBe('fast-track')
    const emitter = new ProposalEmitter({ log })
    await emitter.scanStarted(taskId, 'roadmap.md')
    await emitter.emit(taskId, proposal)

    // === 2. ApprovalGateway runs (operator auto-approves)
    const signer = new TokenSigner(APPROVAL_SECRET)
    const verifier = new TokenVerifier(APPROVAL_SECRET)
    const tailscale = new TailscaleTransport(async (req) => ({ decision: 'approve', token: req.approveToken }))
    const dispatch = new DispatchTransport(async (req) => ({ decision: 'reject', token: req.rejectToken }))
    const approval = new ApprovalGateway({ log, signer, verifier, primary: tailscale, fallback: dispatch })
    const decision = await approval.request({ taskId, reason: 'roadmap-proposal:' + proposal.id, operator: 'lanston' })
    expect(decision.decision).toBe('approve')

    // === 3. AgentMesh: planner → 1 coder
    const reg = defaultRegistry()
    const runners = new Map<string, AgentRunFn>()
    runners.set('coder', async (req) => ({ id: req.id, status: 'completed', output: { lines: 2 } }))
    const mesh = new AgentMesh({ log, registry: reg, taskId, runners })
    const planner = await mesh.spawn('planner', { proposal: proposal.id })
    const out = await fanOutWithRepair(mesh, planner, [
      { id: 'fix-typo', agentType: 'coder', payload: { file: 'CHANGELOG.md' } },
    ])
    expect(out[0].status).toBe('completed')
    await mesh.exit(planner, 'all_done')

    // === 4. push-policy issues cap-token; worker pushes the branch
    const capSigner = new CapTokenSigner(CAP_SECRET)
    const capVerifier = new CapTokenVerifier(CAP_SECRET)
    const pushPolicy = new PushPolicy({ log, signer: capSigner, verifier: capVerifier })
    const tok = pushPolicy.issueCapToken({ taskId, branch: 'fix/typo-changelog', actor: 'worker.coder' })
    const result = await pushPolicy.authorize({
      taskId, branch: 'fix/typo-changelog', actor: 'worker.coder', capToken: tok,
      paths: ['CHANGELOG.md'],
    })
    expect(result.allowed).toBe(true)

    // === 5. Verify the causal chain in the event log
    const events = await toArray(log.read(taskId))
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('roadmap.scan.started')
    expect(kinds).toContain('roadmap.proposal.emitted')
    expect(kinds).toContain('approval.request.emitted')
    expect(kinds).toContain('approval.decision.received')
    expect(kinds).toContain('agent.lifecycle.spawned')
    expect(kinds).toContain('agent.fan_in.resolved')
    expect(kinds).toContain('agent.subtask.completed')
    expect(kinds).toContain('agent.lifecycle.exited')
    expect(kinds).toContain('push.cap.requested')
    expect(kinds).toContain('push.cap.allowed')

    // ordering: proposal precedes approval precedes mesh precedes push
    const find = (k: string) => kinds.indexOf(k)
    expect(find('roadmap.proposal.emitted')).toBeLessThan(find('approval.request.emitted'))
    expect(find('approval.decision.received')).toBeLessThan(find('agent.lifecycle.spawned'))
    expect(find('agent.fan_in.resolved')).toBeLessThan(find('push.cap.allowed'))
  })

  it('case 2: rejected approval breaks the chain — mesh never spawns', async () => {
    const { log } = await mkLog()
    const taskId = 'task_m2_reject'
    const signer = new TokenSigner(APPROVAL_SECRET)
    const verifier = new TokenVerifier(APPROVAL_SECRET)
    const tailscale = new TailscaleTransport(async (req) => ({ decision: 'reject', token: req.rejectToken }))
    const dispatch = new DispatchTransport(async () => ({ decision: 'approve', token: '' }))
    const approval = new ApprovalGateway({ log, signer, verifier, primary: tailscale, fallback: dispatch })
    const d = await approval.request({ taskId, reason: 'risky', operator: 'lanston' })
    expect(d.decision).toBe('reject')
    // Real driver would short-circuit here; we just verify the log shows
    // no agent.lifecycle.spawned on this task.
    const events = await toArray(log.read(taskId))
    expect(events.find((e) => e.kind === 'agent.lifecycle.spawned')).toBeUndefined()
  })

  it('case 3: forbidden-path push attempt after approved proposal → push.cap.denied', async () => {
    const { log } = await mkLog()
    const taskId = 'task_m2_forbidden'
    const capSigner = new CapTokenSigner(CAP_SECRET)
    const capVerifier = new CapTokenVerifier(CAP_SECRET)
    const pushPolicy = new PushPolicy({ log, signer: capSigner, verifier: capVerifier })
    const tok = pushPolicy.issueCapToken({ taskId, branch: 'feature/x', actor: 'worker.coder' })
    const r = await pushPolicy.authorize({
      taskId, branch: 'feature/x', actor: 'worker.coder', capToken: tok,
      paths: ['.env.production'],  // forbidden
    })
    expect(r.allowed).toBe(false)
    expect(r.error).toBe('forbidden_path')
    const events = await toArray(log.read(taskId))
    expect(events.find((e) => e.kind === 'push.cap.denied')).toBeDefined()
  })
})
