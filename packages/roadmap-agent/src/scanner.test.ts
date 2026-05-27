import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import {
  scanRoadmap,
  ProposalEmitter,
  runOnce,
  boundedScan,
  pathIsInScope,
  RoadmapScanOutOfScopeError,
} from './index.js'

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-cron-'))
  return { dir, log: new FileEventLog({ dir }) }
}

describe('roadmap-agent · cron cap + overflow (CC_RESTORE_SPEC T3)', () => {
  it('case 1: 76 candidates → cap 5 → 5 emitted + overflow HOLD', async () => {
    const { log } = await mkLog()
    const lines: string[] = ['# Roadmap', '']
    for (let i = 0; i < 76; i++) lines.push(`- [ ] task ${i + 1}`)
    const tmp = path.join(os.tmpdir(), `rm-flood-${Date.now()}.md`)
    await fs.writeFile(tmp, lines.join('\n'), 'utf8')

    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({
      roadmapPath: tmp,
      taskId: 'task_flood',
      emitter,
      scopePaths: [tmp],
      maxProposalsPerTick: 5,
    })

    expect(outcome.scanned).toBe(76)
    expect(outcome.emitted).toBe(5)
    expect(outcome.overflow).toBe(71)
    expect(outcome.cap).toBe(5)

    const events = await toArray(log.read('task_flood'))
    const kinds = events.map((e) => e.kind)
    expect(kinds[0]).toBe('roadmap.scan.started')
    expect(kinds[1]).toBe('cli.scan.summary')
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
    const outcome = await runOnce({
      roadmapPath: tmp,
      taskId: 'task_small',
      emitter,
      scopePaths: [tmp],
      maxProposalsPerTick: 5,
    })
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
    const outcome = await runOnce({
      roadmapPath: tmp,
      taskId: 'task_exact',
      emitter,
      scopePaths: [tmp],
      maxProposalsPerTick: 5,
    })
    expect(outcome.emitted).toBe(5)
    expect(outcome.overflow).toBe(0)
  })

  it('case 4: scan.summary always emitted, even when zero candidates', async () => {
    const { log } = await mkLog()
    const tmp = path.join(os.tmpdir(), `rm-empty-${Date.now()}.md`)
    await fs.writeFile(tmp, '# Roadmap\n\n(no tasks yet)\n', 'utf8')
    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({
      roadmapPath: tmp,
      taskId: 'task_empty',
      emitter,
      scopePaths: [tmp],
      maxProposalsPerTick: 5,
    })
    expect(outcome.scanned).toBe(0)
    expect(outcome.emitted).toBe(0)
    const events = await toArray(log.read('task_empty'))
    const summary = events.find((e) => e.kind === 'cli.scan.summary')
    expect(summary).toBeDefined()
    expect((summary!.payload as { candidates: number }).candidates).toBe(0)
  })

  it('case 5: cap configurable; cap=2 with 4 candidates emits 2 + overflow 2', async () => {
    const { log } = await mkLog()
    const tmp = path.join(os.tmpdir(), `rm-cap2-${Date.now()}.md`)
    await fs.writeFile(tmp, '- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n', 'utf8')
    const emitter = new ProposalEmitter({ log })
    const outcome = await runOnce({
      roadmapPath: tmp,
      taskId: 'task_cap2',
      emitter,
      scopePaths: [tmp],
      maxProposalsPerTick: 2,
    })
    expect(outcome.emitted).toBe(2)
    expect(outcome.overflow).toBe(2)
  })

  it('case 6: scanRoadmap (pure parser) returns all candidates — no cap, no scope', () => {
    const text = ['- [ ] one', '- [ ] two', '- [ ] three', '- [ ] four', '- [ ] five', '- [ ] six', '- [ ] seven'].join('\n')
    const out = scanRoadmap('fake.md', text)
    expect(out.length).toBe(7)
  })
})

describe('roadmap-agent · scanner scope guard (CC_RESTORE_SPEC T3.fix-1)', () => {
  it('pathIsInScope: exact match', () => {
    expect(pathIsInScope('docs/roadmap.md', ['docs/roadmap.md'])).toBe(true)
  })

  it('pathIsInScope: suffix match (absolute path against relative scope entry)', () => {
    expect(pathIsInScope('/abs/repo/docs/roadmap.md', ['docs/roadmap.md'])).toBe(true)
  })

  it('pathIsInScope: basename only matches when scope entry has no slash', () => {
    expect(pathIsInScope('/abs/repo/other/roadmap.md', ['docs/roadmap.md'])).toBe(false)
    expect(pathIsInScope('/abs/repo/other/roadmap.md', ['roadmap.md'])).toBe(true)
  })

  it('pathIsInScope: empty scopePaths denies everything', () => {
    expect(pathIsInScope('docs/roadmap.md', [])).toBe(false)
  })

  it('pathIsInScope: out-of-scope returns false', () => {
    expect(pathIsInScope('CLAUDE.md', ['docs/roadmap.md'])).toBe(false)
    expect(pathIsInScope('packages/foo/README.md', ['docs/roadmap.md'])).toBe(false)
  })

  it('boundedScan: throws RoadmapScanOutOfScopeError when path not in scope', async () => {
    const tmp = path.join(os.tmpdir(), `rm-evil-${Date.now()}.md`)
    await fs.writeFile(tmp, '- [ ] sneaky\n', 'utf8')
    await expect(
      boundedScan({ path: tmp, scopePaths: ['docs/roadmap.md'], maxProposalsPerTick: 5 }),
    ).rejects.toBeInstanceOf(RoadmapScanOutOfScopeError)
  })

  it('boundedScan: in-scope returns accepted + overflow partition', async () => {
    const tmp = path.join(os.tmpdir(), `rm-bs-${Date.now()}.md`)
    const lines = ['# Roadmap']
    for (let i = 0; i < 8; i++) lines.push(`- [ ] item ${i + 1}`)
    await fs.writeFile(tmp, lines.join('\n'), 'utf8')

    const result = await boundedScan({
      path: tmp,
      scopePaths: [tmp],
      maxProposalsPerTick: 3,
    })

    expect(result.scannedPath).toBe(tmp)
    expect(result.candidates.length).toBe(8)
    expect(result.accepted.length).toBe(3)
    expect(result.overflow.length).toBe(5)
    expect(result.cap).toBe(3)
  })

  it('boundedScan: cap=0 puts everything in overflow', async () => {
    const tmp = path.join(os.tmpdir(), `rm-zero-${Date.now()}.md`)
    await fs.writeFile(tmp, '- [ ] a\n- [ ] b\n', 'utf8')
    const result = await boundedScan({
      path: tmp,
      scopePaths: [tmp],
      maxProposalsPerTick: 0,
    })
    expect(result.accepted.length).toBe(0)
    expect(result.overflow.length).toBe(2)
  })

  it('runOnce: out-of-scope path → scanStarted + overflow HOLD with outOfScope=true, no proposals', async () => {
    const { log } = await mkLog()
    const tmp = path.join(os.tmpdir(), `rm-oos-${Date.now()}.md`)
    await fs.writeFile(tmp, '- [ ] would-be-emitted\n', 'utf8')
    const emitter = new ProposalEmitter({ log })

    const outcome = await runOnce({
      roadmapPath: tmp,
      taskId: 'task_oos',
      emitter,
      scopePaths: ['docs/roadmap.md'],
      maxProposalsPerTick: 5,
    })

    expect(outcome.scanned).toBe(0)
    expect(outcome.emitted).toBe(0)

    const events = await toArray(log.read('task_oos'))
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('roadmap.scan.started')
    expect(kinds).not.toContain('cli.scan.summary')
    expect(kinds).not.toContain('roadmap.proposal.emitted')
    const hold = events.find((e) => e.kind === 'hold.policy.created')
    expect(hold).toBeDefined()
    expect((hold!.payload as { reason: string; outOfScope: boolean }).reason).toBe('roadmap_scan_overflow')
    expect((hold!.payload as { outOfScope: boolean }).outOfScope).toBe(true)
  })
})
