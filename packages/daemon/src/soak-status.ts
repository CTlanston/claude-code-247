/**
 * V6-P5 — `soak-pending.json` status artifact (soak operations contract).
 *
 * Pure logic for the one-week fleet soak's pending-state file at
 * `evidence/fleet-soak/soak-pending.json`. The CLI shell is
 * `scripts/soak-status.ts` (`pnpm soak:status`); the runbook is
 * docs/operations/SOAK_OPERATIONS.md. The artifact lets ANY session (or the
 * operator's phone via ntfy) answer "is a soak running, since when, and when
 * should it be done" without parsing daemon logs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const WEEK_MS = 604_800_000

export type SoakStatus = 'running' | 'completed' | 'overdue' | 'failed'

export interface SoakPending {
  /** ISO timestamp the soak process was started. */
  started_at: string
  /** ISO timestamp the soak window elapses (started_at + AEDEV_SOAK_MS). */
  expected_end: string
  status: SoakStatus
}

export function buildSoakPending(startedAt: Date, soakMs: number): SoakPending {
  return {
    started_at: startedAt.toISOString(),
    expected_end: new Date(startedAt.getTime() + soakMs).toISOString(),
    status: 'running',
  }
}

/** Time-derived status: terminal states (completed/failed) are sticky; a
 *  'running' soak whose window has elapsed without anyone marking it
 *  completed reads as 'overdue' — honest "needs a human look", never a
 *  silent fake-complete. */
export function deriveSoakStatus(pending: SoakPending, now: Date): SoakStatus {
  if (pending.status === 'completed' || pending.status === 'failed') return pending.status
  return now.getTime() > Date.parse(pending.expected_end) ? 'overdue' : 'running'
}

export function writeSoakPending(filePath: string, pending: SoakPending): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(pending, null, 2)}\n`)
}

const STATUSES: readonly string[] = ['running', 'completed', 'overdue', 'failed']

/** Fail-closed reader: missing file, broken JSON, or a wrong shape all read
 *  as null so callers never act on a half-written artifact. */
export function readSoakPending(filePath: string): SoakPending | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    if (
      typeof raw['started_at'] !== 'string'
      || typeof raw['expected_end'] !== 'string'
      || typeof raw['status'] !== 'string'
      || !STATUSES.includes(raw['status'])
    ) return null
    return { started_at: raw['started_at'], expected_end: raw['expected_end'], status: raw['status'] as SoakStatus }
  } catch {
    return null
  }
}
