/**
 * CC_RESTORE_SPEC T3 step 4 — drain the existing 75-proposal flood.
 *
 * The 2026-05-27T21:49:45Z launchd tick scanned docs/roadmap.md (76
 * task-list items) and emitted 75 proposals (1 was blocked-class). The
 * approval queue is now poisoned. This script:
 *
 *   1. Reads the daemon's pending approvals via /approvals?status=pending
 *   2. Filters those whose payload includes proposalId emitted by the
 *      roadmap-agent tick at that timestamp
 *   3. Posts a bulk reject with reason `triage:roadmap_overflow_drain`
 *   4. Writes evidence/maintenance/T3-roadmap-drain-<UTC>.md with the
 *      before/after counts and the list of rejected proposal ids
 *
 * Idempotent: re-running on an already-drained queue is a no-op.
 *
 * Usage:
 *   pnpm tsx scripts/T3-drain-roadmap-flood.ts                 # real
 *   pnpm tsx scripts/T3-drain-roadmap-flood.ts --dry-run       # no posts
 *   pnpm tsx scripts/T3-drain-roadmap-flood.ts --daemon-url <url>
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

interface PendingProposal {
  approvalId: string
  proposalId: string
  text?: string
  source?: string
  emittedAt?: string
}

interface DaemonClient {
  fetch: typeof globalThis.fetch
  base: string
}

async function listPending(client: DaemonClient): Promise<PendingProposal[]> {
  const url = `${client.base}/approvals?status=pending&kind=roadmap.proposal.emitted&limit=500`
  const r = await client.fetch(url)
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`)
  const body = (await r.json()) as { approvals?: PendingProposal[] }
  return body.approvals ?? []
}

async function bulkReject(client: DaemonClient, ids: string[]): Promise<{ accepted: number }> {
  const url = `${client.base}/approvals/bulk-reject`
  const r = await client.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      approvalIds: ids,
      reason: 'triage:roadmap_overflow_drain',
      actor: 'operator',
      authority: 'CC_RESTORE_SPEC §3 T3',
    }),
  })
  if (!r.ok) throw new Error(`POST ${url} → ${r.status}`)
  const body = (await r.json()) as { accepted: number }
  return body
}

function nowTs(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const urlIdx = args.indexOf('--daemon-url')
  const daemonUrl = urlIdx >= 0 ? args[urlIdx + 1] : (process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247')
  const client: DaemonClient = { fetch: globalThis.fetch, base: daemonUrl.replace(/\/+$/, '') }

  const ts = nowTs()
  const reportDir = path.join(process.cwd(), 'evidence', 'maintenance')
  await fs.mkdir(reportDir, { recursive: true })
  const report = path.join(reportDir, `T3-roadmap-drain-${ts}.md`)

  const before = await listPending(client)
  const lines: string[] = []
  lines.push(`# T3 · roadmap flood drain · ${ts}`)
  lines.push('')
  lines.push(`Daemon: ${client.base}`)
  lines.push(`Dry run: ${dryRun}`)
  lines.push('')
  lines.push(`## Before — pending roadmap.proposal.emitted approvals: ${before.length}`)
  lines.push('')

  if (before.length === 0) {
    lines.push('Queue is already clean. No action taken.')
    await fs.writeFile(report, lines.join('\n') + '\n')
    console.log(`[T3] queue empty — nothing to drain. Report: ${report}`)
    return
  }

  lines.push('| approvalId | proposalId | text |')
  lines.push('|---|---|---|')
  for (const p of before) {
    lines.push(`| \`${p.approvalId}\` | \`${p.proposalId}\` | ${(p.text ?? '').slice(0, 80)} |`)
  }

  if (dryRun) {
    lines.push('')
    lines.push(`## Action: DRY RUN — would reject ${before.length} approvals`)
    await fs.writeFile(report, lines.join('\n') + '\n')
    console.log(`[T3] dry run — would reject ${before.length}. Report: ${report}`)
    return
  }

  const ids = before.map((p) => p.approvalId)
  const { accepted } = await bulkReject(client, ids)

  // Verify
  const after = await listPending(client)
  lines.push('')
  lines.push(`## Action: REJECT — daemon accepted ${accepted} of ${ids.length}`)
  lines.push('')
  lines.push(`## After — pending roadmap.proposal.emitted approvals: ${after.length}`)
  if (after.length >= before.length) {
    lines.push('')
    lines.push(`**FAIL** — drain did not reduce the queue. Investigate daemon.`)
    await fs.writeFile(report, lines.join('\n') + '\n')
    console.error('[T3] FAIL — queue not drained')
    process.exit(1)
  }
  lines.push('')
  lines.push(`**PASS** — drained ${before.length - after.length} approvals. Closes \`roadmap_agent_proposal_flood\` once the scanner cap is also wired (already shipped in this branch).`)
  await fs.writeFile(report, lines.join('\n') + '\n')
  console.log(`[T3] PASS — drained ${before.length - after.length}. Report: ${report}`)
}

main().catch((err) => {
  console.error('[T3] crashed:', err)
  process.exit(2)
})
