import { promises as fs } from 'node:fs'
import { scanRoadmap, type RoadmapCandidate } from './scanner.js'
import { classify } from './classifier.js'
import type { ProposalEmitter } from './emitter.js'

export interface CronOpts {
  roadmapPath: string
  taskId: string
  emitter: ProposalEmitter
}

/** Single-shot scan + emit; the daemon's scheduler calls this on cadence. */
export async function runOnce(opts: CronOpts): Promise<{ scanned: number; emitted: number }> {
  const text = await fs.readFile(opts.roadmapPath, 'utf8').catch(() => '')
  const candidates: RoadmapCandidate[] = scanRoadmap(opts.roadmapPath, text)
  await opts.emitter.scanStarted(opts.taskId, opts.roadmapPath)
  let emitted = 0
  for (const c of candidates) {
    const classified = classify({ id: c.id, text: c.text })
    if (classified.track === 'blocked') continue
    await opts.emitter.emit(opts.taskId, classified)
    emitted++
  }
  return { scanned: candidates.length, emitted }
}
