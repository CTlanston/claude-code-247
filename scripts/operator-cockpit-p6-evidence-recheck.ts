/**
 * P6 evidence re-check — NO worker run, NO remote writes, NO PR touch.
 *
 * Re-runs the Gemini + OpenAI validators on the EXACT s_0041 mission evidence:
 *   BEFORE — every file as-shipped, including the raw coder dump
 *            (claude-docker-raw.json) whose hallucinated filename/counts
 *            contradicted the git diff, which drew the inconclusive verdicts; and
 *   AFTER  — the P6 fix applied: (1) changed-paths.json rewritten from the real
 *            git diff (single vintage), (2) done-report/test-summary regenerated
 *            with the authoritative git change set + an explicit, labelled
 *            coder-self-report discrepancy note, (3) raw machine/coder dumps
 *            demoted from the validator bundle (kept on disk, not fed to the
 *            validators) — mirroring readEvidenceBundle's NON_EVIDENCE_BUNDLE_FILES.
 *
 * Isolates the one thing the fix changes — what the validators see — so we can
 * confirm whether the dual validators move off the consistency-driven inconclusive.
 * Read-only. Needs GEMINI_API_KEY + OPENAI_API_KEY (injected by the secrets
 * wrapper). No Docker worker, no Claude token, no remote writes, no GitHub writes.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GeminiValidator, OpenAIValidator } from '@aedev/validators'
import { renderDockerWorkerSummaries, runRepoTests } from '../packages/runner/src/claude-docker-runner.js'

const MISSION_EVIDENCE = process.env['AEDEV_P6_EVIDENCE_DIR'] ?? '/Users/lanston/.aedev/state/evidence/01KT0RVZXMABZBNTARGV8Z0TXZ'
const TASK_ID = process.env['AEDEV_P6_TASK_ID'] ?? '01KT0SKWBE5CNKFBYN0WHV8VP9'

// Mirrors NON_EVIDENCE_BUNDLE_FILES in packages/daemon/src/mission-runner.ts (the P6
// fix): raw machine/coder dumps are demoted from the validator bundle (kept on disk).
const DEMOTED = new Set(['claude-docker-raw.json', 'cli-envelope.json', 'result.json', 'docker-meta.json', 'stdout.log', 'stderr.log'])

function readBundle(dir: string, demote: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of readdirSync(dir)) {
    if (demote && DEMOTED.has(e)) continue
    const f = join(dir, e)
    try { if (statSync(f).isFile()) out[e] = readFileSync(f, 'utf8') } catch { /* skip */ }
  }
  return out
}

function safeParse(s: string | undefined): Record<string, unknown> {
  try { return s ? JSON.parse(s) as Record<string, unknown> : {} } catch { return {} }
}

/** The authoritative changed-file list, parsed from diff-summary.md's "## Changed files" block. */
function gitChangedFiles(diffSummary: string): string[] {
  const lines = diffSummary.split('\n')
  const start = lines.findIndex((l) => /^##\s+Changed files/i.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) break
    const m = lines[i]!.match(/^-\s+(.+\S)\s*$/)
    if (m) out.push(m[1]!)
  }
  return out
}

async function main(): Promise<void> {
  if (!existsSync(MISSION_EVIDENCE)) throw new Error(`mission evidence dir not found: ${MISSION_EVIDENCE}`)

  // BEFORE: exactly what the s_0041 validators saw — every file, raw coder dump included.
  const before = readBundle(MISSION_EVIDENCE, false)

  // AFTER: apply the P6 fix to a copy.
  const fixedDir = mkdtempSync(join(tmpdir(), 'aedev-p6-fixed-'))
  cpSync(MISSION_EVIDENCE, fixedDir, { recursive: true })
  const gitFiles = gitChangedFiles(before['diff-summary.md'] ?? '')
  const rawReport = safeParse(before['claude-docker-raw.json'])
  const coderReportedPaths = Array.isArray(rawReport['files_changed'])
    ? (rawReport['files_changed'] as unknown[]).filter((p): p is string => typeof p === 'string') : []
  const usage = safeParse(before['model-usage.json'])
  // (1) single-vintage changed-paths.json from the real git diff
  writeFileSync(join(fixedDir, 'changed-paths.json'), JSON.stringify({ changedPaths: gitFiles, worktreePath: '(s_0041)' }, null, 2))
  // (2) regenerate done-report + test-summary: git authoritative + labelled discrepancy
  // Independently re-run the repo's tests on the PR-branch worktree so the AFTER
  // test-summary carries a RUNNER-VERIFIED result (not the coder's claim). Read-only.
  const testWorktree = process.env['AEDEV_P6_TEST_WORKTREE'] ?? '/tmp/hermus-pr3-wt'
  const verifiedTest = existsSync(testWorktree) ? await runRepoTests(testWorktree, ['python3 -m pytest -q'], 120_000) : undefined
  console.log(`runner-verified tests: ${verifiedTest ? `${verifiedTest.command} -> exit ${verifiedTest.exitCode}, ${verifiedTest.passed ?? '?'} passed` : '(test worktree unavailable — honest fallback)'}`)
  const { testSummary, doneReport } = renderDockerWorkerSummaries({
    taskId: TASK_ID, exitCode: 0, dockerExitCode: 0,
    changedPaths: gitFiles, testCommands: ['python3 -m pytest -q'], verifiedTest,
    inputTokens: Number(usage['inputTokens'] ?? 0), outputTokens: Number(usage['outputTokens'] ?? 0),
    costUsd: (usage['costUsd'] as number | null | undefined) ?? null,
    workdir: '(s_0041 docker worktree)', evidenceDir: fixedDir,
    transcript: before['transcript-summary.md'] ?? '',
  })
  writeFileSync(join(fixedDir, 'test-summary.md'), testSummary)
  writeFileSync(join(fixedDir, 'done-report.md'), doneReport)
  // (3) read with raw machine/coder dumps demoted from the validator bundle
  const after = readBundle(fixedDir, true)

  console.log(`git-authoritative changed files: ${JSON.stringify(gitFiles)}`)
  console.log(`coder self-reported files (demoted): ${JSON.stringify(coderReportedPaths)}`)

  // Consistency diagnostics for the AFTER bundle (the fix should leave NO trace of the
  // hallucinated filename, and the test-summary should be runner-verified):
  const afterHasWrongName = Object.entries(after).filter(([, v]) => /artifact_paths/.test(v)).map(([k]) => k)
  console.log(`after-bundle files still mentioning the hallucinated name: ${JSON.stringify(afterHasWrongName)}`)
  console.log(`after test-summary is runner-verified: ${/Runner-verified/.test(after['test-summary.md'] ?? '')}`)

  const gemini = new GeminiValidator({ apiKey: process.env['GEMINI_API_KEY'] })
  // OpenAI defaults to gpt-4o-mini (too weak to reliably parse a ~30-file bundle —
  // it misreads present files as "missing"); use a capable model to actually READ
  // the (correct) evidence, matching Gemini's tier. Overridable via AEDEV_OPENAI_MODEL.
  const openaiModel = process.env['AEDEV_OPENAI_MODEL'] ?? 'gpt-4o'
  const openai = new OpenAIValidator({ apiKey: process.env['OPENAI_API_KEY'], model: openaiModel })
  console.log(`validator models: gemini=gemini-2.5-pro, openai=${openaiModel}`)
  // Distinct task id per phase rules out any id-keyed effect; full summaries (untruncated).
  const phases: Array<[string, Record<string, string>, string]> = [
    ['BEFORE — s_0041 as-shipped (raw coder dump in the bundle)', before, `${TASK_ID}-before`],
    ['AFTER  — P6 fix (git authoritative + runner-verified tests + coder dump demoted)', after, `${TASK_ID}-after`],
  ]
  for (const [label, bundle, tid] of phases) {
    console.log(`\n===== ${label} =====`)
    for (const v of [gemini, openai]) {
      try {
        const r = await v.validate(tid, bundle)
        console.log(`[${r.validator}] ${r.verdict.toUpperCase()} — ${(r.summary ?? '').replace(/\s+/g, ' ').slice(0, 700)}`)
      } catch (e) {
        console.log(`[validator] ERROR — ${(e as Error).message}`)
      }
    }
  }
  console.log('\n(read-only; no worker run, no remote writes, PR #3 untouched)')
}

main().catch((e) => { console.error(e); process.exit(1) })
