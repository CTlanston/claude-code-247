import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import { AgentMesh, defaultRegistry, fanOutWithRepair, type AgentRunFn } from './index.js'

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repair-'))
  return { dir, log: new FileEventLog({ dir }) }
}

describe('agent-mesh · auto-Repair escalation (Stage M3 L1)', () => {
  it('case 1: 1 of 3 coders fails → repair fixes it → final result all completed', async () => {
    const { log } = await mkLog()
    const reg = defaultRegistry()
    const runners = new Map<string, AgentRunFn>()
    let coderAttempts = 0
    runners.set('coder', async (req) => {
      coderAttempts++
      // First attempt at st-2 fails; the repair retry (different id `#repair1`) succeeds.
      if (req.id === 'st-2') return { id: req.id, status: 'failed', error: 'first attempt broke' }
      return { id: req.id, status: 'completed' }
    })
    const mesh = new AgentMesh({ log, registry: reg, taskId: 'task_m3r', runners })
    const planner = await mesh.spawn('planner', {})
    const out = await fanOutWithRepair(mesh, planner, [
      { id: 'st-1', agentType: 'coder', payload: {} },
      { id: 'st-2', agentType: 'coder', payload: {} },
      { id: 'st-3', agentType: 'coder', payload: {} },
    ])
    expect(out.every((r) => r.status === 'completed')).toBe(true)
    expect(coderAttempts).toBe(4) // 3 first-pass + 1 repair
    const events = await toArray(log.read('task_m3r'))
    // Repair agent itself was spawned + exited
    const repairSpawn = events.find((e) => e.kind === 'agent.lifecycle.spawned' && (e.payload as { agentType: string }).agentType === 'repair')
    expect(repairSpawn).toBeDefined()
    const repairExit = events.find((e) => e.kind === 'agent.lifecycle.exited' && (e.payload as { reason: string }).reason === 'repair_complete')
    expect(repairExit).toBeDefined()
  })

  it('case 2: 2 of 5 coders fail → repair fixes both → result all completed', async () => {
    const { log } = await mkLog()
    const reg = defaultRegistry()
    const runners = new Map<string, AgentRunFn>()
    const failOnFirst = new Set(['st-b', 'st-d'])
    runners.set('coder', async (req) => {
      if (failOnFirst.has(req.id)) {
        failOnFirst.delete(req.id)
        return { id: req.id, status: 'failed', error: 'flaky' }
      }
      return { id: req.id, status: 'completed' }
    })
    const mesh = new AgentMesh({ log, registry: reg, taskId: 'task_m3r', runners })
    const planner = await mesh.spawn('planner', {})
    const out = await fanOutWithRepair(mesh, planner, [
      { id: 'st-a', agentType: 'coder', payload: {} },
      { id: 'st-b', agentType: 'coder', payload: {} },
      { id: 'st-c', agentType: 'coder', payload: {} },
      { id: 'st-d', agentType: 'coder', payload: {} },
      { id: 'st-e', agentType: 'coder', payload: {} },
    ])
    expect(out.filter((r) => r.status === 'completed').length).toBe(5)
  })

  it('case 3: persistently broken subtask → repair exits partial; final status reflects failure', async () => {
    const { log } = await mkLog()
    const reg = defaultRegistry()
    const runners = new Map<string, AgentRunFn>()
    runners.set('coder', async () => ({ id: 'x', status: 'failed', error: 'always broken' }))
    const mesh = new AgentMesh({ log, registry: reg, taskId: 'task_m3r', runners })
    const planner = await mesh.spawn('planner', {})
    const out = await fanOutWithRepair(mesh, planner, [{ id: 'st-bad', agentType: 'coder', payload: {} }])
    expect(out[0].status).toBe('failed')
    const events = await toArray(log.read('task_m3r'))
    const repairExit = events.find((e) => e.kind === 'agent.lifecycle.exited')
    expect((repairExit!.payload as { reason: string }).reason).toBe('repair_partial')
  })
})
