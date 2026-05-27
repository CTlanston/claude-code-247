import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import { scanRoadmap, ProposalEmitter, runOnce } from './index.js'

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-cron-'))
  return { dir, log: new FileEventLog({ dir }) }
}

describe('roadmap-agent · cron cap + overflow (CC_RESTORE_SPEC T3)', () => {
  it('case 1: 76 candidates → cap 5 → 5 emitted + overflow HOLD', async () => {
    const { log } = await mkLog()
    // Generate a roadmap.md the same shape as the real one.
    const lines: string[] = ['# Roadmap', '']
    for (let i = 0; i < 76; i++) lines.push(`- [ ] task ${i + 1}`)
    const tmp = path.join(os.tmpdir(), `rm-flood-${Date.now()}.md`)
    await fs.writeFile(tmp, lines.join('\n'), 'utf8')

    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({
      roadmapPath: tmp,
      taskId: 'task_flood',
      emitter,
      maxProposalsPerTick: 5,
    })

    expect(outcome.scanned).toBe(76)
    expect(outcome.emitted).toBe(5)
    expect(outcome.overflow).toBe(76 - 0 - 5) // assume nothing blocked-class in raw "task N"
    expect(outcome.cap).toBe(5)

    const events = await toArray(log.read('task_flood'))
    const kinds = events.map((e) => e.kind)
    // Sequence: scan.started → scan.summary → 5x proposal.emitted → overflow HOLD
    expect(kinds[0]).toBe('roadmap.scan.started')
    expect(kinds[1]).toBe('roadmap.scan.summary')
    expect(kinds.filter((k) => k === 'roadmap.proposal.emitted').length).toBe(5)
    const overflowHold = events.find(
      (e) => e.kind === 'hold.policy.created' &&
             (e.payload as { reason: string }).reason === 'roadmap_scan_overflow',
    )
    expect(overflowHold).toBeDefined()
    expect((overflowHold!.payload as { overflow: number }).overflow).toBe(outcome.overflow)
  })

  it('case 2: under cap → no overflow event', async () => {
    const { log } = await mkLog()
    const tmp = path.join(os.tmpdir(), `rm-small-${Date.now()}.md`)
    await fs.writeFile(tmp, '# Roadmap\n\n- [ ] one\n- [ ] two\n- [ ] three\n', 'utf8')
    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({ roadmapPath: tmp, taskId: 'task_small', emitter, maxProposalsPerTick: 5 })
    expect(outcome.emitted).toBe(3)
    expect(outcome.overflow).toBe(0)
    const events = await toArray(log.read('task_small'))
    expect(events.find((e) => e.kind === 'hold.policy.created')).toBeUndefined()
  })

  it('case 3: exactly at cap → emit all, no overflow', async () => {
    const { log } = await mkLog()
    const tmp = path.join(os.tmpdir(), `rm-exact-${Date.now()}.md`)
    const items = ['# Roadmap', '']
    for (let i = 0; i < 5; i++) items.push(`- [ ] exact ${i + 1}`)
    await fs.writeFile(tmp, items.join('\n'), 'utf8')
    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({ roadmapPath: tmp, taskId: 'task_exact', emitter, maxProposalsPerTick: 5 })
    expect(outcome.emitted).toBe(5)
    expect(outcome.overflow).toBe(0)
  })

  it('case 4: scan.summary always emitted, even when zero candidates', async () => {
    const { log } = await mkLog()
    const tmp = path.join(os.tmpdir(), `rm-empty-${Date.now()}.md`)
    await fs.writeFile(tmp, '# Roadmap\n\n(no tasks yet)\n', 'utf8')
    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({ roadmapPath: tmp, taskId: 'task_empty', emitter, maxProposalsPerTick: 5 })
    expect(outcome.scanned).toBe(0)
    expect(outcome.emitted).toBe(0)
    const events = await toArray(log.read('task_empty'))
    const summary = events.find((e) => e.kind === 'roadmap.scan.summary')
    expect(summary).toBeDefined()
    expect((summary!.payload as { candidates: number }).candidates).toBe(0)
  })

  it('case 5: cap configurable; cap=2 with 4 candidates emits 2 + overflow 2', async () => {
    const { log } = await mkLog()
    const tmp = path.join(os.tmpdir(), `rm-cap2-${Date.now()}.md`)
    await fs.writeFile(tmp, '- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n', 'utf8')
    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({ roadmapPath: tmp, taskId: 'task_cap2', emitter, maxProposalsPerTick: 2 })
    expect(outcome.emitted).toBe(2)
    expect(outcome.overflow).toBe(2)
  })

  it('case 6: scanner alone (no cron) still returns all candidates — cap lives in the driver', () => {
    const text = ['- [ ] one', '- [ ] two', '- [ ] three', '- [ ] four', '- [ ] five', '- [ ] six', '- [ ] seven'].join('\n')
    const out = scanRoadmap('fake.md', text)
    expect(out.length).toBe(7)
  })
})
