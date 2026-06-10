/**
 * P3 live remote-write smoke.
 *
 * Exercises the REAL remote-write path end-to-end against a DISPOSABLE repo:
 *   1. gate blocks (REMOTE_WRITES_DISABLED) and pushes nothing when off;
 *   2. with allow_remote_writes ON (for this repo only, never persisted),
 *      push a branch + open a real DRAFT PR via gh;
 *   3. verify the PR is a draft and NOT merged;
 *   4. idempotent re-run reuses the same PR (no dup, still not merged).
 *
 * Never merges. Never edits any config file. Scoped to AEDEV_P3_REPO only.
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Repo } from '@aedev/core'
import { DraftPrGate, DraftPrGateError } from '@aedev/daemon'
import { GhGitRemoteWriter, GhDraftPrCreator } from '@aedev/runner'

const SLUG = process.env['AEDEV_P3_REPO'] ?? 'CTlanston/aedev-p3-smoke'
const [OWNER, NAME] = SLUG.split('/')
const OUT_DIR = join(process.cwd(), 'evidence', 'launch')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const BRANCH = `p3-smoke-${STAMP}`
const log: string[] = []
const failures: string[] = []

function sh(cmd: string, args: string[], cwd?: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function say(line: string): void { console.log(`[p3] ${line}`); log.push(`- ${line}`) }

async function main(): Promise<void> {
  const clone = mkdtempSync(join(tmpdir(), 'aedev-p3-clone-'))
  sh('gh', ['repo', 'clone', SLUG, clone, '--', '--depth', '1'])
  const base = sh('gh', ['repo', 'view', SLUG, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']) || 'main'
  say(`cloned ${SLUG}; base=${base}; branch=${BRANCH}`)

  // local commit on a fresh branch (not yet pushed)
  sh('git', ['-C', clone, 'switch', '-c', BRANCH])
  writeFileSync(join(clone, `NOTE-${STAMP}.md`), `P3 remote-write smoke at ${new Date().toISOString()}\n`)
  sh('git', ['-C', clone, 'add', '-A'])
  sh('git', ['-C', clone, '-c', 'user.name=aedev-p3', '-c', 'user.email=ctlanston@gmail.com', 'commit', '-m', 'P3 smoke: evidence-only note'])
  say('made a local commit on the branch (not pushed yet)')

  const repo: Repo = {
    id: 'p3', name: NAME!, path: clone, githubOwner: OWNER!, githubRepo: NAME!, defaultBranch: base,
    enabled: true, testCommands: [], forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md', 'CLAUDE.md'],
    riskRules: {}, mergePolicy: 'WAITING', createdAt: '', updatedAt: '',
  }
  const req = {
    repo, missionId: 'p3-smoke', title: `P3 remote-write smoke ${STAMP}`, branch: BRANCH, base,
    changedPaths: [`NOTE-${STAMP}.md`], evidenceUri: 'local', riskScore: 0, validatorResults: [],
    rollbackNotes: 'Close the draft PR; nothing was merged.',
  }
  const git = new GhGitRemoteWriter()
  const pr = new GhDraftPrCreator()

  // 1) gate OFF blocks + pushes nothing
  try {
    await new DraftPrGate({ allowRemoteWrites: false, remoteWriteWhitelist: [req.repo.name] }, git, pr).openDraftPr(req)
    failures.push('gate did NOT block when allow_remote_writes=false')
  } catch (e) {
    const code = e instanceof DraftPrGateError ? e.code : 'ERR'
    if (code === 'REMOTE_WRITES_DISABLED') say('gate OFF -> blocked REMOTE_WRITES_DISABLED (expected)')
    else failures.push(`gate OFF threw unexpected: ${(e as Error).message}`)
  }
  const remoteAfterBlock = sh('git', ['-C', clone, 'ls-remote', '--heads', 'origin', BRANCH])
  if (remoteAfterBlock) failures.push('branch was pushed despite allow_remote_writes=false')
  else say('confirmed: no remote branch exists after the blocked attempt')

  // 2) gate ON -> push + draft PR
  const info = await new DraftPrGate({ allowRemoteWrites: true, remoteWriteWhitelist: [req.repo.name] }, git, pr).openDraftPr(req)
  say(`gate ON -> draft PR #${info.number} ${info.url} (state=${info.state}, draft=${info.draft})`)

  // 3) verify draft + not merged
  const view = JSON.parse(sh('gh', ['pr', 'view', String(info.number), '--repo', SLUG, '--json', 'number,isDraft,state,mergedAt']))
  if (!view.isDraft) failures.push(`PR #${info.number} is not a draft`)
  if (view.mergedAt) failures.push(`PR #${info.number} was merged (mergedAt=${view.mergedAt})`)
  if (String(view.state).toUpperCase() !== 'OPEN') failures.push(`PR #${info.number} state is ${view.state}, expected OPEN`)
  say(`verified PR #${info.number}: isDraft=${view.isDraft} state=${view.state} mergedAt=${view.mergedAt ?? 'null'}`)

  // 4) idempotent re-run reuses the same PR
  const again = await new DraftPrGate({ allowRemoteWrites: true, remoteWriteWhitelist: [req.repo.name] }, git, pr).openDraftPr(req)
  if (again.number !== info.number) failures.push(`idempotency broke: re-run made PR #${again.number} (first #${info.number})`)
  const openCount = JSON.parse(sh('gh', ['pr', 'list', '--repo', SLUG, '--head', BRANCH, '--state', 'open', '--json', 'number'])).length
  if (openCount !== 1) failures.push(`expected exactly 1 open PR for ${BRANCH}, found ${openCount}`)
  say(`idempotent re-run -> same PR #${again.number}; open PRs for branch = ${openCount}`)

  rmSync(clone, { recursive: true, force: true })
  writeReport(info)
}

function writeReport(info: { number: number; url: string; state: string }): void {
  mkdirSync(OUT_DIR, { recursive: true })
  const passed = failures.length === 0
  const path = join(OUT_DIR, `operator-cockpit-p3-remote-smoke-${STAMP}.md`)
  writeFileSync(path, [
    '# Operator Cockpit — P3 Live Remote-Write Smoke',
    '', `Date: ${new Date().toISOString()}`, `Repo: ${SLUG} (disposable)`,
    `Result: ${passed ? 'PASS' : 'FAIL'}`,
    `Draft PR: #${info.number} ${info.url} (state=${info.state})`,
    '', '## Timeline', ...log,
    '', '## Safety invariants',
    passed
      ? '- gate blocked with REMOTE_WRITES_DISABLED when off (no branch pushed); draft PR created when on; PR is a DRAFT and was never merged; idempotent re-run reused the same PR.'
      : failures.map((f) => `- VIOLATION: ${f}`).join('\n'),
    '', '## Notes',
    '- allow_remote_writes was passed true ONLY in-process for this disposable repo; no config file was modified, so the global default stays false.',
    '- No merge was performed. The draft PR is left open for inspection.',
  ].join('\n') + '\n')
  console.log(`[p3] evidence report: ${path}`)
  if (!passed) { console.error(`[p3] FAIL: ${failures.join('; ')}`); process.exitCode = 1 }
  else console.log('[p3] PASS — real remote-write path works and stayed safe')
}

void main().catch((e) => { console.error(e); process.exitCode = 1 })
