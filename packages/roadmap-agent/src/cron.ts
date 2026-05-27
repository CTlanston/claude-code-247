import { promises as fs } from 'node:fs'
import { scanRoadmap, type RoadmapCandidate } from './scanner.js'
import { classify } from './classifier.js'
import type { ProposalEmitter } from './emitter.js'

export interface CronOpts {
  roadmapPath: string
  taskId: string
  emitter: ProposalEmitter
  /**
   * CC_RESTORE_SPEC T3 — hard cap on proposals emitted per tick.
   * When scan produces more eligible candidates than this, only the
   * first `cap` are emitted and a hold.policy.created event with
   * reason `roadmap_scan_overflow` carries the rest so the operator
   * triages.
   *
   * Default: 5 (the 75-from-76 flood on 2026-05-27 motivated this).
   */
  maxProposalsPerTick?: number
}

export interface CronOutcome {
  scanned: number       // total candidates from the file
  eligible: number      // non-blocked
  emitted: number       // ≤ cap
  overflow: number      // eligible − emitted
  cap: number           // the cap that was applied
}

/** Single-shot scan + emit. Daemon launchd job calls this on cadence. */
export async function runOnce(opts: CronOpts): Promise<CronOutcome> {
  const cap = opts.maxProposalsPerTick ?? 5
  const text = await fs.readFile(opts.roadmapPath, 'utf8').catch(() => '')
  const candidates: RoadmapCandidate[] = scanRoadmap(opts.roadmapPath, text)
  await opts.emitter.scanStarted(opts.taskId, opts.roadmapPath)

  // Emit scan summary BEFORE classifying (per spec — gives operator
  // visibility into candidate count even if cap drops everything).
  await opts.emitter.scanSummary(opts.taskId, {
    source: opts.roadmapPath,
    candidates: candidates.length,
    cap,
  })

  const eligible: Array<{ id: string; text: string; track: 'fast-track' | 'standard' | 'blocked'; reason: string }> = []
  for (const c of candidates) {
    const classified = classify({ id: c.id, text: c.text })
    if (classified.track === 'blocked') continue
    eligible.push(classified)
  }

  const emit = eligible.slice(0, cap)
  const overflow = eligible.length - emit.length
  let emitted = 0
  for (const p of emit) {
    await opts.emitter.emit(opts.taskId, p)
    emitted++
  }

  if (overflow > 0) {
    await opts.emitter.overflowHold(opts.taskId, {
      source: opts.roadmapPath,
      candidates: candidates.length,
      eligible: eligible.length,
      emitted,
      overflow,
      cap,
    })
  }

  return {
    scanned: candidates.length,
    eligible: eligible.length,
    emitted,
    overflow,
    cap,
  }
}
