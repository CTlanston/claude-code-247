import type { AedevDb } from '@aedev/core'

/**
 * Per-day rollup of mission, task, run, and approval activity.  Phase 10
 * will wire this into the scheduler so a daily report lands in memory
 * automatically; for now it is a standalone reporter callable from CLI or
 * tests.
 */
export interface DailySummaryOptions {
  /** YYYY-MM-DD.  Defaults to today in the caller's timezone. */
  date?: string
  /** Hide sections that are empty.  Default true. */
  hideEmpty?: boolean
}

export interface DailySummaryStats {
  date: string
  missionsCreated: number
  missionsApproved: number
  missionsCompleted: number
  tasksCreated: number
  tasksDone: number
  tasksFailed: number
  runsStarted: number
  runsCompleted: number
  pendingApprovals: number
}

export class DailySummaryGenerator {
  constructor(private readonly db: AedevDb) {}

  stats(opts: DailySummaryOptions = {}): DailySummaryStats {
    const date = opts.date ?? new Date().toISOString().slice(0, 10)
    const since = `${date}T00:00:00`
    const until = `${date}T23:59:59`
    const inner = this.db as unknown as { db: { prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } } }
    const raw = inner.db

    const count = (sql: string, ...args: unknown[]): number => {
      const row = raw.prepare(sql).get(...args) as { c: number } | undefined
      return row?.c ?? 0
    }

    return {
      date,
      missionsCreated: count(`SELECT COUNT(*) AS c FROM missions WHERE created_at BETWEEN ? AND ?`, since, until),
      missionsApproved: count(`SELECT COUNT(*) AS c FROM missions WHERE status='approved' AND updated_at BETWEEN ? AND ?`, since, until),
      missionsCompleted: count(`SELECT COUNT(*) AS c FROM missions WHERE status='done' AND updated_at BETWEEN ? AND ?`, since, until),
      tasksCreated: count(`SELECT COUNT(*) AS c FROM tasks WHERE created_at BETWEEN ? AND ?`, since, until),
      tasksDone: count(`SELECT COUNT(*) AS c FROM tasks WHERE status='done' AND updated_at BETWEEN ? AND ?`, since, until),
      tasksFailed: count(`SELECT COUNT(*) AS c FROM tasks WHERE status='failed' AND updated_at BETWEEN ? AND ?`, since, until),
      runsStarted: count(`SELECT COUNT(*) AS c FROM runs WHERE started_at BETWEEN ? AND ?`, since, until),
      runsCompleted: count(`SELECT COUNT(*) AS c FROM runs WHERE status='done' AND completed_at BETWEEN ? AND ?`, since, until),
      pendingApprovals: count(`SELECT COUNT(*) AS c FROM approvals WHERE status='pending'`),
    }
  }

  /** Render the daily summary as markdown.  Used by Phase 10's daemon broadcaster. */
  render(opts: DailySummaryOptions = {}): string {
    const s = this.stats(opts)
    const hideEmpty = opts.hideEmpty !== false
    const lines: string[] = [
      `# Daily Summary — ${s.date}`,
      '',
      '## Missions',
      `- created: ${s.missionsCreated}`,
      `- approved: ${s.missionsApproved}`,
      `- completed: ${s.missionsCompleted}`,
      '',
      '## Tasks',
      `- created: ${s.tasksCreated}`,
      `- done: ${s.tasksDone}`,
      `- failed: ${s.tasksFailed}`,
      '',
      '## Runs',
      `- started: ${s.runsStarted}`,
      `- completed: ${s.runsCompleted}`,
      '',
      '## Approvals',
      `- pending: ${s.pendingApprovals}`,
      '',
    ]
    if (hideEmpty) {
      const isEmpty =
        s.missionsCreated + s.missionsApproved + s.missionsCompleted +
        s.tasksCreated + s.tasksDone + s.tasksFailed +
        s.runsStarted + s.runsCompleted + s.pendingApprovals === 0
      if (isEmpty) {
        return `# Daily Summary — ${s.date}\n\nNo activity recorded.\n`
      }
    }
    return lines.join('\n')
  }
}
