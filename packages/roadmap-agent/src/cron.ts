import { boundedScan, type BoundedScanOpts, RoadmapScanOutOfScopeError } from './scanner.js'
import { classify } from './classifier.js'
import type { ProposalEmitter } from './emitter.js'

export interface CronOpts {
  roadmapPath: string
  taskId: string
  emitter: ProposalEmitter
  /**
   * CC_RESTORE_SPEC T3 — scope_paths whitelist. Scanner refuses any
   * path NOT on this list. Default mirrors config/default.yaml.
   */
  scopePaths?: readonly string[]
  /**
   * Per-tick cap. Default 5 (the 75-from-76 flood on 2026-05-27
   * motivated this).
   */
  maxProposalsPerTick?: number
}

export interface CronOutcome {
  scanned: number        // total candidates from the file (no cap)
  accepted: number       // first N (N = cap) that entered classify
  eligible: number       // non-blocked, post-classify, within cap
  emitted: number        // actually emitted (== eligible)
  overflow: number       // candidates above the cap (raw — not classified)
  cap: number            // the cap that was applied
}

/**
 * Single-shot scan + emit. Daemon launchd job calls this on cadence.
 *
 * Defense-in-depth: scope + cap live in boundedScan (scanner.ts). This
 * driver consumes the scanner's output, drives the event-emission
 * order the spec mandates, and routes overflow to a HOLD.
 *
 * Sequence (CC_RESTORE_SPEC §3 T3):
 *   1. boundedScan → throws if path outside scope; returns {candidates,
 *      accepted, overflow, cap}
 *   2. emit roadmap.scan.started + cli.scan.summary BEFORE classifying
 *      (operator visibility into "we saw N, capping to M")
 *   3. classify the `accepted` slice; drop blocked-class
 *   4. emit ≤ accepted.length proposal events
 *   5. if overflow.length > 0, emit hold.policy.created with reason
 *      roadmap_scan_overflow
 */
export async function runOnce(opts: CronOpts): Promise<CronOutcome> {
  const scopePaths = opts.scopePaths ?? ['docs/roadmap.md']
  const cap = opts.maxProposalsPerTick ?? 5

  let scan
  try {
    scan = await boundedScan({
      path: opts.roadmapPath,
      scopePaths,
      maxProposalsPerTick: cap,
    } satisfies BoundedScanOpts)
  } catch (err) {
    if (err instanceof RoadmapScanOutOfScopeError) {
      // Surface as overflow HOLD so the operator sees the rejection
      // chain even if the scanner refused to read.
      await opts.emitter.scanStarted(opts.taskId, opts.roadmapPath)
      await opts.emitter.overflowHold(opts.taskId, {
        source: opts.roadmapPath,
        candidates: 0,
        eligible: 0,
        emitted: 0,
        overflow: 0,
        cap,
        outOfScope: true,
      })
      return { scanned: 0, accepted: 0, eligible: 0, emitted: 0, overflow: 0, cap }
    }
    throw err
  }

  await opts.emitter.scanStarted(opts.taskId, scan.scannedPath)
  await opts.emitter.scanSummary(opts.taskId, {
    source: scan.scannedPath,
    candidates: scan.candidates.length,
    cap,
  })

  // Classify only the accepted (capped) slice — defense at the boundary
  // means we never even consider items past the cap.
  const eligible: Array<{ id: string; text: string; track: 'fast-track' | 'standard' | 'blocked'; reason: string }> = []
  for (const c of scan.accepted) {
    const classified = classify({ id: c.id, text: c.text })
    if (classified.track === 'blocked') continue
    eligible.push(classified)
  }

  let emitted = 0
  for (const p of eligible) {
    await opts.emitter.emit(opts.taskId, p)
    emitted++
  }

  if (scan.overflow.length > 0) {
    await opts.emitter.overflowHold(opts.taskId, {
      source: scan.scannedPath,
      candidates: scan.candidates.length,
      eligible: eligible.length,
      emitted,
      overflow: scan.overflow.length,
      cap,
    })
  }

  return {
    scanned: scan.candidates.length,
    accepted: scan.accepted.length,
    eligible: eligible.length,
    emitted,
    overflow: scan.overflow.length,
    cap,
  }
}
