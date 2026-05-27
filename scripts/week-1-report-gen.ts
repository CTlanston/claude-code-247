/**
 * CC_RESTORE_SPEC T4 step 4 — auto-generate week-1-report.md from the
 * event log + the operator's day-1..7.md journal entries.
 *
 * Operator runs this at end of day 7. Output:
 *   - evidence/launch/week-1-report.md (auto-generated header +
 *     SLA snapshot + mission tally + HOLD table; operator fills the
 *     4 reflection questions at the bottom)
 *
 * Data sources:
 *   - daemon /events?since=<7d ago> (counts by kind, mission tally,
 *     HOLD MTTR)
 *   - daemon /metrics (current snapshot of §0 SLA gauges)
 *   - evidence/launch/day-1..7.md (existence + word count per day)
 *
 * If the daemon is unreachable, the report is still generated with
 * the journal-derived sections and explicit `n/a` in the SLA section
 * (per GR14 — no synthetic stand-ins).
 *
 * Usage:
 *   pnpm tsx scripts/week-1-report-gen.ts
 *   pnpm tsx scripts/week-1-report-gen.ts --daemon-url http://127.0.0.1:7247
 *   pnpm tsx scripts/week-1-report-gen.ts --since 2026-05-27T00:00:00Z
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

interface DaemonStats {
  reachable: boolean
  uptime_pct_7d?: number
  cost_per_pr_usd_7d?: number
  hold_mttr_p95_min?: number
  sentinel_false_block_rate?: number
  autonomous_pr_success_rate_7d?: number
  missions_started_7d?: number
  missions_completed_7d?: number
  holds_opened_7d?: number
  holds_auto_resolved_7d?: number
  idempotency_collisions_7d?: number
  cap_token_rejections_7d?: number
  cost_cap_breaches_7d?: number
  fetchError?: string
}

interface JournalEntry {
  day: number
  exists: boolean
  size_bytes: number
  word_count: number
  appears_real: boolean      // > template baseline + references a task_id
}

interface Args {
  daemonUrl: string
  since: string
  out: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const since = get('since') ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  return {
    daemonUrl: (get('daemon-url') ?? process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247').replace(/\/+$/, ''),
    since,
    out: get('out') ?? path.join(process.cwd(), 'evidence', 'launch', 'week-1-report.md'),
  }
}

async function fetchDaemonStats(base: string, since: string): Promise<DaemonStats> {
  try {
    const r = await fetch(`${base}/sla/week-1?since=${encodeURIComponent(since)}`)
    if (!r.ok) {
      return { reachable: false, fetchError: `HTTP ${r.status} from ${base}/sla/week-1` }
    }
    const body = await r.json() as Partial<DaemonStats>
    return { reachable: true, ...body }
  } catch (err) {
    return { reachable: false, fetchError: err instanceof Error ? err.message : String(err) }
  }
}

async function inspectJournal(day: number): Promise<JournalEntry> {
  const p = path.join(process.cwd(), 'evidence', 'launch', `day-${day}.md`)
  let s: { size: number } | undefined
  let text = ''
  try {
    s = await fs.stat(p)
    text = await fs.readFile(p, 'utf8')
  } catch {
    return { day, exists: false, size_bytes: 0, word_count: 0, appears_real: false }
  }
  const wc = text.trim().split(/\s+/).filter(Boolean).length
  // Heuristic for "real": > 50 words AND contains a task_id-like string
  const hasTaskId = /\b(task_|mission_|appr_|evt_)[A-Za-z0-9_-]{4,}/.test(text)
  return {
    day,
    exists: true,
    size_bytes: s.size,
    word_count: wc,
    appears_real: wc > 50 && hasTaskId,
  }
}

function renderJournalRow(j: JournalEntry): string {
  if (!j.exists) return `| day-${j.day} | (missing) | — | — | NO |`
  return `| day-${j.day} | ${j.size_bytes}B | ${j.word_count} words | task_id ref: ${j.appears_real ? 'yes' : 'no'} | ${j.appears_real ? '✓' : '✗'} |`
}

function pct(n: number | undefined): string {
  return typeof n === 'number' ? `${n.toFixed(2)}%` : 'n/a'
}

function usd(n: number | undefined): string {
  return typeof n === 'number' ? `$${n.toFixed(2)}` : 'n/a'
}

function num(n: number | undefined): string {
  return typeof n === 'number' ? `${n}` : 'n/a'
}

function meets(actual: number | undefined, predicate: (a: number) => boolean): string {
  if (typeof actual !== 'number') return '?'
  return predicate(actual) ? '✓' : '✗'
}

async function main(): Promise<void> {
  const args = parseArgs()
  const stats = await fetchDaemonStats(args.daemonUrl, args.since)
  const journals: JournalEntry[] = []
  for (let d = 1; d <= 7; d++) journals.push(await inspectJournal(d))
  const realDayCount = journals.filter((j) => j.appears_real).length

  const lines: string[] = []
  lines.push('# Week-1 Live-Fire Report')
  lines.push('')
  lines.push(`Window: ${args.since} → ${new Date().toISOString()}`)
  lines.push(`Daemon: ${args.daemonUrl}${stats.reachable ? '' : ' (unreachable — see note below)'}`)
  lines.push('')
  if (!stats.reachable) {
    lines.push('> **Daemon unreachable at report time.** SLA section is `n/a` per')
    lines.push(`> GR14. Reason: \`${stats.fetchError}\`. Re-run when daemon is up`)
    lines.push('> to populate.')
    lines.push('')
  }

  lines.push('## Acceptance bullets (NEXT_PLAN_WORKBOOK §3 L1)')
  lines.push('')
  lines.push('| Bullet | Target | Observed | PASS? |')
  lines.push('|---|---|---|---|')
  lines.push(`| daemon uptime ≥ 99.0% | 99.0% | ${pct(stats.uptime_pct_7d)} | ${meets(stats.uptime_pct_7d, (a) => a >= 99)} |`)
  lines.push(`| ≥ 3 missions complete end-to-end | 3 | ${num(stats.missions_completed_7d)} | ${meets(stats.missions_completed_7d, (a) => a >= 3)} |`)
  lines.push(`| ≥ 1 auto-resolved HOLD cycle | 1 | ${num(stats.holds_auto_resolved_7d)} | ${meets(stats.holds_auto_resolved_7d, (a) => a >= 1)} |`)
  lines.push(`| 0 cost-cap breaches | 0 | ${num(stats.cost_cap_breaches_7d)} | ${meets(stats.cost_cap_breaches_7d, (a) => a === 0)} |`)
  lines.push(`| 0 idempotency collisions | 0 | ${num(stats.idempotency_collisions_7d)} | ${meets(stats.idempotency_collisions_7d, (a) => a === 0)} |`)
  lines.push(`| ≥ 1 real cap-token rejection | 1 | ${num(stats.cap_token_rejections_7d)} | ${meets(stats.cap_token_rejections_7d, (a) => a >= 1)} |`)
  lines.push('')

  lines.push('## SLA snapshot (post_launch_review = end of this week)')
  lines.push('')
  lines.push('| SLA | Target | Observed |')
  lines.push('|---|---|---|')
  lines.push(`| daemon_uptime_pct_7d | ≥ 99.0% | ${pct(stats.uptime_pct_7d)} |`)
  lines.push(`| autonomous_pr_success_rate_7d | ≥ 0.5 | ${num(stats.autonomous_pr_success_rate_7d)} |`)
  lines.push(`| cost_per_autonomous_pr_usd_7d | ≤ $8 (hard cap $15) | ${usd(stats.cost_per_pr_usd_7d)} |`)
  lines.push(`| sentinel_false_block_rate_7d | ≤ 0.05 | ${num(stats.sentinel_false_block_rate)} |`)
  lines.push(`| hold_mttr_p95_min_7d | ≤ 30 min | ${num(stats.hold_mttr_p95_min)} |`)
  lines.push('')

  lines.push('## Journal coverage')
  lines.push('')
  lines.push('| Day | Size | Word count | Heuristic | Real? |')
  lines.push('|---|---|---|---|---|')
  for (const j of journals) lines.push(renderJournalRow(j))
  lines.push('')
  lines.push(`Real journals: **${realDayCount} / 7**`)
  if (realDayCount < 7) {
    lines.push('')
    lines.push(`> ${7 - realDayCount} day(s) missing or template-grade. Per GR14, those days do NOT count toward L1 acceptance.`)
  }
  lines.push('')

  lines.push('---')
  lines.push('')
  lines.push('## Operator reflection (NEXT_PLAN_WORKBOOK §3 Phase L1 L3 — 4 questions)')
  lines.push('')
  lines.push('### Q1. Did the daemon surprise you in a bad way?')
  lines.push('> Y / N + one line:')
  lines.push('>')
  lines.push('> _<fill>_')
  lines.push('')
  lines.push('### Q2. Was the cost within expectation?')
  lines.push('> Y / N + actual $:')
  lines.push('>')
  lines.push('> _<fill>_')
  lines.push('')
  lines.push('### Q3. Was every phone notification useful?')
  lines.push('> Y / N + count of noise:')
  lines.push('>')
  lines.push('> _<fill>_')
  lines.push('')
  lines.push('### Q4. Did trust in the system grow or shrink this week?')
  lines.push('> ↑ / ↓ / =')
  lines.push('>')
  lines.push('> _<fill>_')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Gate G2 decision (NEXT_PLAN_WORKBOOK §7)')
  lines.push('')
  lines.push('- **≥ 4/6 acceptance bullets met + no data-loss incident** → proceed to L2')
  lines.push('- **2-3 misses** → ADR + continue cautiously')
  lines.push('- **≥ 4 misses, or any data-loss incident** → pause; consider `mesh.enabled=false` rollback')
  lines.push('')
  lines.push('**Operator verdict:** _PROCEED / CAUTIOUS / PAUSE_')
  lines.push('')
  lines.push(`**Signature:** _<operator name + ${new Date().toISOString()}>_`)
  lines.push('')

  await fs.writeFile(args.out, lines.join('\n'))
  console.log(`[week-1-report] wrote ${args.out}`)
  console.log(`  daemon reachable: ${stats.reachable}`)
  console.log(`  real journals: ${realDayCount}/7`)
}

main().catch((e) => {
  console.error('[week-1-report] crashed:', e)
  process.exit(1)
})
