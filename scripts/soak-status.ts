/**
 * V6-P5 — soak-pending status CLI (`pnpm soak:status -- <command>`).
 *
 * Writes/reads the `evidence/fleet-soak/soak-pending.json` artifact
 * (contract: packages/daemon/src/soak-status.ts; runbook:
 * docs/operations/SOAK_OPERATIONS.md).
 *
 *   pnpm soak:status                       read + derive current status
 *   pnpm soak:status -- start              mark a soak started now
 *                                          (window = AEDEV_SOAK_MS, default 1 week)
 *   pnpm soak:status -- complete           mark the soak completed (terminal)
 *   pnpm soak:status -- fail               mark the soak failed (terminal)
 *
 * Override the artifact path with AEDEV_SOAK_PENDING_PATH (used by the
 * launchd wrapper so the artifact follows the evidence directory).
 */
import { join, resolve } from 'node:path'
import {
  WEEK_MS,
  buildSoakPending,
  deriveSoakStatus,
  readSoakPending,
  writeSoakPending,
  type SoakPending,
} from '@aedev/daemon'

const PATH = process.env['AEDEV_SOAK_PENDING_PATH']
  ?? join(resolve(process.cwd()), 'evidence', 'fleet-soak', 'soak-pending.json')
// pnpm forwards a literal '--' separator; ignore it.
const command = process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'status'
const now = new Date()

function print(p: SoakPending | null): void {
  if (p === null) {
    console.log(`no soak pending (${PATH} missing or invalid)`)
    return
  }
  const derived = deriveSoakStatus(p, now)
  console.log(JSON.stringify({ ...p, status: derived }, null, 2))
  if (derived === 'overdue') {
    console.log('NOTE: the soak window has elapsed without a completion mark — generate the report'
      + ' (see docs/operations/SOAK_OPERATIONS.md §failure-recovery) and then `pnpm soak:status -- complete`.')
  }
}

switch (command) {
  case 'start': {
    const soakMs = Number(process.env['AEDEV_SOAK_MS'] ?? WEEK_MS)
    const pending = buildSoakPending(now, Number.isFinite(soakMs) && soakMs > 0 ? soakMs : WEEK_MS)
    writeSoakPending(PATH, pending)
    console.log(`soak-pending written: ${PATH}`)
    print(pending)
    break
  }
  case 'complete':
  case 'fail': {
    const existing = readSoakPending(PATH)
    if (existing === null) {
      console.error(`cannot mark "${command}": no valid soak-pending at ${PATH}`)
      process.exitCode = 1
      break
    }
    const updated: SoakPending = { ...existing, status: command === 'complete' ? 'completed' : 'failed' }
    writeSoakPending(PATH, updated)
    print(updated)
    break
  }
  case 'status': {
    const p = readSoakPending(PATH)
    print(p)
    if (p === null) process.exitCode = 1
    break
  }
  default: {
    console.error(`unknown command "${command}" — use: status | start | complete | fail`)
    process.exitCode = 1
  }
}
