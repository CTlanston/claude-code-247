/** Stage M2 + CC_RESTORE_SPEC T3 — scope-bound roadmap scanner.
 *
 * Two entry points:
 *   - scanRoadmap(file, content) — pure parser, no guards. Used by tests
 *     and direct callers that have already enforced scope themselves.
 *   - boundedScan(opts) — the SAFE entry point. Enforces scope_paths
 *     whitelist BEFORE reading and emits cli.scan.summary BEFORE the
 *     caller classifies. Caps result length and reports overflow
 *     separately so the caller can route to a HOLD.
 *
 * Why two entry points (per CC_RESTORE_SPEC §3 T3): defense belongs in
 * the scanner, not in the cron caller. A future driver that bypasses
 * cron.runOnce must still hit the same scope guard, OR be required to
 * call scanRoadmap explicitly (which is named with "raw" semantics).
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'

export interface RoadmapCandidate {
  /** Stable id derived from the line content. */
  id: string
  /** Raw item text (no leading "- [ ] "). */
  text: string
  /** Source pointer for traceability. */
  source: { file: string; line: number }
}

const RE_TODO = /^\s*[-*]\s*\[ \]\s+(.+?)\s*$/

function lineId(file: string, line: number, text: string): string {
  const h = createHash('sha1').update(`${file}|${line}|${text}`).digest('hex')
  return `proposal_${h.slice(0, 12)}`
}

/** Pure parser. Reads any string content; does NOT enforce scope. */
export function scanRoadmap(file: string, content: string): RoadmapCandidate[] {
  const lines = content.split('\n')
  const out: RoadmapCandidate[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = RE_TODO.exec(lines[i])
    if (m) out.push({ id: lineId(file, i + 1, m[1]), text: m[1], source: { file, line: i + 1 } })
  }
  return out
}

/** A scope_paths entry is matched against the input path by basename OR
 *  by suffix; both forms are valid. (Operators write "docs/roadmap.md";
 *  the cron caller may pass a fully-resolved absolute path.) */
export function pathIsInScope(inputPath: string, scopePaths: readonly string[]): boolean {
  if (scopePaths.length === 0) return false
  const normalized = path.normalize(inputPath)
  for (const allowed of scopePaths) {
    const a = path.normalize(allowed)
    if (normalized === a) return true
    if (normalized.endsWith(path.sep + a)) return true
    if (path.basename(normalized) === path.basename(a) && a !== '') {
      // basename match is only allowed when scope entry has no slash —
      // otherwise it would let docs/roadmap.md match anyfolder/roadmap.md.
      if (!a.includes(path.sep)) return true
    }
  }
  return false
}

export class RoadmapScanOutOfScopeError extends Error {
  constructor(public readonly attempted: string, public readonly scopePaths: readonly string[]) {
    super(`roadmap path "${attempted}" is outside scope_paths ${JSON.stringify(scopePaths)}`)
    this.name = 'RoadmapScanOutOfScopeError'
  }
}

export interface BoundedScanOpts {
  /** Path to read. Validated against scope_paths before any I/O. */
  path: string
  /** Allowlist of paths the scanner may read from. */
  scopePaths: readonly string[]
  /** Hard cap on the number of candidates returned. Candidates beyond
   *  this number are reported via `overflow`, NOT included in `accepted`. */
  maxProposalsPerTick: number
}

export interface BoundedScanResult {
  /** Path that was scanned (after scope validation). */
  scannedPath: string
  /** All candidates the parser found, in file order. */
  candidates: RoadmapCandidate[]
  /** First N candidates, where N = maxProposalsPerTick (or fewer if
   *  fewer candidates exist). */
  accepted: RoadmapCandidate[]
  /** Candidates beyond the cap. Length 0 if cap not exceeded. */
  overflow: RoadmapCandidate[]
  /** The cap that was applied (for echoing in summary events). */
  cap: number
}

/**
 * Safe entry point. Refuses paths outside scope_paths (throws
 * RoadmapScanOutOfScopeError). Reads + parses; partitions into
 * `accepted` (≤ cap) and `overflow` (the rest). Does NOT emit events
 * itself — caller drives event emission so this stays a pure function
 * over fs.readFile.
 *
 * Callers (cron.ts) are expected to:
 *   1. emit cli.scan.summary BEFORE classifying anything
 *   2. classify and emit ≤ cap proposal events
 *   3. emit hold.policy.created (reason=roadmap_scan_overflow) iff
 *      overflow.length > 0
 */
export async function boundedScan(opts: BoundedScanOpts): Promise<BoundedScanResult> {
  if (!pathIsInScope(opts.path, opts.scopePaths)) {
    throw new RoadmapScanOutOfScopeError(opts.path, opts.scopePaths)
  }
  const text = await fs.readFile(opts.path, 'utf8').catch(() => '')
  const candidates = scanRoadmap(opts.path, text)
  const cap = Math.max(0, opts.maxProposalsPerTick)
  const accepted = candidates.slice(0, cap)
  const overflow = candidates.slice(cap)
  return {
    scannedPath: opts.path,
    candidates,
    accepted,
    overflow,
    cap,
  }
}
