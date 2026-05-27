export interface DispatchDecision {
  taskId: string
  /** Decision name (dispatch / hold / skip / etc). */
  action: string
  /** Optional structured detail; deep-compared at diff time. */
  detail?: Record<string, unknown>
  ts: string
}

export interface DiffReport {
  /** Total decisions on the canonical (left) side. */
  total: number
  /** Decisions present on both sides with identical (action, detail). */
  agree: number
  /** Decisions present on both sides with different (action, detail). */
  disagree: number
  /** Decisions present only on left (Python). */
  leftOnly: number
  /** Decisions present only on right (TS). */
  rightOnly: number
  /** disagree + leftOnly + rightOnly, normalized by total. */
  driftRate: number
  /** Sample of disagreement details (cap at 50 for log volume). */
  sample: Array<{ taskId: string; left?: DispatchDecision; right?: DispatchDecision }>
}

function key(d: DispatchDecision): string {
  return `${d.taskId}|${d.action}|${JSON.stringify(d.detail ?? {})}`
}

/**
 * Compare two dispatcher decision streams (Python canonical vs TS shadow).
 *
 * Both streams are matched on taskId. For each task, we compare the LATEST
 * decision per side (timing-stable across ms jitter).
 *
 * Stage F1 success criterion: driftRate < 0.001 (the workbook says 0.1%).
 */
export function diffStreams(
  leftLabel: 'python' | 'ts',
  left: DispatchDecision[],
  right: DispatchDecision[],
): DiffReport {
  const byTaskLeft = collapseToLatest(left)
  const byTaskRight = collapseToLatest(right)
  const allTasks = new Set([...byTaskLeft.keys(), ...byTaskRight.keys()])
  let agree = 0
  let disagree = 0
  let leftOnly = 0
  let rightOnly = 0
  const sample: DiffReport['sample'] = []
  const SAMPLE_CAP = 50
  for (const t of allTasks) {
    const l = byTaskLeft.get(t)
    const r = byTaskRight.get(t)
    if (l && r) {
      if (key(l) === key(r)) agree += 1
      else {
        disagree += 1
        if (sample.length < SAMPLE_CAP) sample.push({ taskId: t, left: l, right: r })
      }
    } else if (l && !r) {
      leftOnly += 1
      if (sample.length < SAMPLE_CAP) sample.push({ taskId: t, left: l })
    } else if (!l && r) {
      rightOnly += 1
      if (sample.length < SAMPLE_CAP) sample.push({ taskId: t, right: r })
    }
  }
  const total = byTaskLeft.size
  const driftRate = total === 0 ? 0 : (disagree + leftOnly + rightOnly) / total
  void leftLabel
  return { total, agree, disagree, leftOnly, rightOnly, driftRate, sample }
}

function collapseToLatest(stream: DispatchDecision[]): Map<string, DispatchDecision> {
  const m = new Map<string, DispatchDecision>()
  for (const d of stream) {
    const prior = m.get(d.taskId)
    if (!prior || d.ts > prior.ts) m.set(d.taskId, d)
  }
  return m
}

/** Convenience: assert drift below threshold; returns true/false. */
export function withinThreshold(report: DiffReport, threshold: number): boolean {
  return report.driftRate < threshold
}
