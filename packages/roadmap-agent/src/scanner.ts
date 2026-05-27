/** Stage M2 — roadmap scanner.
 *
 * Reads a roadmap.md file (and optionally a list of GitHub Issue summaries)
 * and extracts candidate mission proposals. The format we recognize is
 * the GitHub-flavored task-list:
 *
 *     - [ ] Implement /events SSE endpoint
 *     - [x] Done already — skipped
 *     - [ ] Fix typo in CHANGELOG
 */

export interface RoadmapCandidate {
  /** Stable id derived from the line content. */
  id: string
  /** Raw item text (no leading "- [ ] "). */
  text: string
  /** Source pointer for traceability. */
  source: { file: string; line: number }
}

const RE_TODO = /^\s*[-*]\s*\[ \]\s+(.+?)\s*$/

import { createHash } from 'node:crypto'

function lineId(file: string, line: number, text: string): string {
  const h = createHash('sha1').update(`${file}|${line}|${text}`).digest('hex')
  return `proposal_${h.slice(0, 12)}`
}

export function scanRoadmap(file: string, content: string): RoadmapCandidate[] {
  const lines = content.split('\n')
  const out: RoadmapCandidate[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = RE_TODO.exec(lines[i])
    if (m) out.push({ id: lineId(file, i + 1, m[1]), text: m[1], source: { file, line: i + 1 } })
  }
  return out
}
