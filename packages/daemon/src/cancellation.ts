import type { AedevDb } from '@aedev/core'

/**
 * Cancellation fence (operator Stop).
 *
 * When the operator presses Stop, the mission is moved to `cancelled`. The
 * worker runs in a detached promise (and the CLI in a detached process group),
 * so it can still finish AFTER the cancel. Every code path that writes a FINAL
 * mission/session status — done / failed / waiting / paused / result / summary —
 * MUST call this fence first. If the mission is already cancelled the late
 * worker result is recorded as ignored and the caller MUST skip the
 * status-overwriting write, so the cancelled state is never clobbered and the
 * dashboard never flips "Cancelled → done/failed".
 *
 * This is a WRITE fence, not a process kill. If the engine cannot expose the
 * worker subprocess handle, the detached CLI keeps running until it exits or
 * times out, but it can no longer pollute the cancelled DB state. True
 * subprocess termination remains an engine/architect follow-up.
 */
export function isMissionCancelled(db: AedevDb, missionId: string): boolean {
  return db.getMission(missionId)?.status === 'cancelled'
}

/**
 * Returns true (and records a `mission.result_ignored_cancelled` diagnostic)
 * when a final write must be skipped because the operator cancelled the mission.
 */
export function skipFinalWriteIfCancelled(db: AedevDb, missionId: string, context: string, wouldHaveWritten?: string): boolean {
  if (!isMissionCancelled(db, missionId)) return false
  db.insertEvent('mission.result_ignored_cancelled', 'mission', missionId, {
    context,
    ...(wouldHaveWritten ? { wouldHaveWritten } : {}),
    note: 'Mission was cancelled by the operator; the in-flight worker result is ignored to preserve the cancelled state.',
  })
  return true
}
