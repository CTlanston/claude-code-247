import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import { scanRoadmap, classify, ProposalEmitter, runOnce } from './index.js'

const ROADMAP = `# Roadmap

## v2.2

- [ ] Implement /events SSE endpoint
- [ ] Fix typo in CHANGELOG
- [x] Done item, skipped
- [ ] Polish README
- [ ] Drop column legacy_status (breaking change)
- [ ] Add capability token rotation cron
- [ ] TODO: blocked on Cloudflare API limit

## Notes

random prose that should be ignored
- not a checkbox
`

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-'))
  return { dir, log: new FileEventLog({ dir }) }
}

describe('roadmap-agent · scanner (Stage M2 L1)', () => {
  it('case 1: scanner finds only unchecked items, ignores done + prose', () => {
    const items = scanRoadmap('roadmap.md', ROADMAP)
    const texts = items.map((i) => i.text)
    expect(texts).toContain('Implement /events SSE endpoint')
    expect(texts).toContain('Fix typo in CHANGELOG')
    expect(texts).not.toContain('Done item, skipped')
    expect(texts).not.toContain('not a checkbox')
    expect(items.length).toBe(6)
  })

  it('case 2: scanner ids are stable across two reads', () => {
    const a = scanRoadmap('roadmap.md', ROADMAP)
    const b = scanRoadmap('roadmap.md', ROADMAP)
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id))
  })
})

describe('roadmap-agent · classifier (Stage M2 L1)', () => {
  it('case 3: typo class → fast-track', () => {
    const c = classify({ id: 'p1', text: 'Fix typo in CHANGELOG' })
    expect(c.track).toBe('fast-track')
  })

  it('case 4: 5 manually-labelled typo items are all fast-track', () => {
    const typos = [
      'Fix typo in CHANGELOG',
      'Correct spelling of "validator"',
      'Polish README wording',
      'Update copy-edit for the install guide',
      'Punctuation fix in docs',
    ]
    for (const t of typos) {
      expect(classify({ id: 't', text: t }).track).toBe('fast-track')
    }
  })

  it('case 5: blocked marker → blocked', () => {
    const c = classify({ id: 'p2', text: 'TODO: blocked on Cloudflare API limit' })
    expect(c.track).toBe('blocked')
  })

  it('case 6: risky migration → standard', () => {
    const c = classify({ id: 'p3', text: 'Drop column legacy_status (breaking change)' })
    expect(c.track).toBe('standard')
  })
})

describe('roadmap-agent · cron + emitter (Stage M2 L1)', () => {
  it('case 7: workbook target — current repo roadmap produces ≥3 proposals', async () => {
    const { log, dir } = await mkLog()
    void dir
    // write a roadmap fixture with the same shape as the repo's real one
    const tmp = path.join(os.tmpdir(), 'rmtmp-' + Date.now() + '.md')
    await fs.writeFile(tmp, ROADMAP, 'utf8')
    const emitter = new ProposalEmitter({ log })
    const { emitted } = await runOnce({ roadmapPath: tmp, taskId: 'task_m2', emitter })
    expect(emitted).toBeGreaterThanOrEqual(3)
    const kinds = (await toArray(log.read('task_m2'))).map((e) => e.kind)
    expect(kinds).toContain('roadmap.scan.started')
    expect(kinds.filter((k) => k === 'roadmap.proposal.emitted').length).toBe(emitted)
  })

  it('case 8: emitter is idempotent — same proposal twice writes one event', async () => {
    const { log } = await mkLog()
    const emitter = new ProposalEmitter({ log })
    const p = { id: 'proposal_aaa', text: 'Fix typo', track: 'fast-track' as const, reason: 'typo' }
    const a = await emitter.emit('task_m2', p)
    const b = await emitter.emit('task_m2', p)
    expect(a).toBe(b)
    const events = (await toArray(log.read('task_m2'))).filter((e) => e.kind === 'roadmap.proposal.emitted')
    expect(events.length).toBe(1)
  })
})
