import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { importTaskEvidence, readEvidenceBundle } from './mission-runner.js'
// readEvidenceBundle now demotes raw dumps; importTaskEvidence is single-vintage (P6).
import { registerEvidenceArtifacts } from './routes/operator.js'

// P6 evidence hardening: the Docker worker's task evidence must reach the mission
// evidence bundle the dual validators read, and the cockpit must surface the
// worker's diff + done report as artifacts. (s_0041 validators went inconclusive
// because the worker summaries were thin / not visible at the mission level.)

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aedev-evidence-agg-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const WORKER_FILES = [
  'diff-summary.md', 'done-report.md', 'test-summary.md',
  'changed-paths.json', 'local-commit.json', 'model-usage.json', 'transcript-summary.md',
] as const

function writeWorkerEvidence(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'diff-summary.md'), '# Diff Summary\n\n## Changed files\n- README.md\n- tests/test_readme_artifacts.py\n')
  writeFileSync(join(dir, 'done-report.md'), '# Done Report\n\n## Changed files (2)\n- README.md\n- tests/test_readme_artifacts.py\n\n## Worker summary (worker-reported)\nAll 20 tests pass.\n')
  writeFileSync(join(dir, 'test-summary.md'), '# Test Summary\n\nTest files in this change: tests/test_readme_artifacts.py\nVerification boundary: runner did not re-run tests.\n')
  writeFileSync(join(dir, 'changed-paths.json'), JSON.stringify({ changedPaths: ['README.md', 'tests/test_readme_artifacts.py'] }))
  writeFileSync(join(dir, 'local-commit.json'), JSON.stringify({ created: true, sha: 'abc123', branch: 'shadow/x' }))
  writeFileSync(join(dir, 'model-usage.json'), JSON.stringify({ provider: 'claude-docker', inputTokens: 10, outputTokens: 20 }))
  writeFileSync(join(dir, 'transcript-summary.md'), 'Added 8 contract tests. All 20 tests pass.\n')
}

describe('mission evidence aggregation (P6)', () => {
  it('imports the Docker worker task evidence into the mission evidence dir', () => {
    const taskDir = join(root, 'tasks', 't1')
    const missionDir = join(root, 'mission')
    mkdirSync(missionDir, { recursive: true })
    writeWorkerEvidence(taskDir)

    importTaskEvidence(taskDir, missionDir)

    for (const f of WORKER_FILES) {
      expect(existsSync(join(missionDir, f)), `${f} imported to mission evidence`).toBe(true)
    }
  })

  it('the validator bundle includes the worker diff + done report (validators can read them)', () => {
    const missionDir = join(root, 'mission')
    writeWorkerEvidence(missionDir)

    const bundle = readEvidenceBundle(missionDir)

    expect(bundle['diff-summary.md']).toContain('test_readme_artifacts.py')
    expect(bundle['done-report.md']).toContain('Changed files')
    expect(bundle['done-report.md']).toContain('Worker summary')
    expect(bundle['changed-paths.json']).toContain('README.md')
  })

  it('registers the worker diff + done report as mission artifacts (overview/UI shows them)', () => {
    const db = new AedevDb(':memory:')
    try {
      const repo = db.insertRepo({
        name: 'r', path: root, defaultBranch: 'main', enabled: true,
        testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
      })
      const mission = db.insertMission({ repoId: repo.id, title: 'm', status: 'draft' })
      const missionDir = join(root, 'mission')
      writeWorkerEvidence(missionDir)

      registerEvidenceArtifacts(db, mission.id, missionDir)

      const names = db.listMissionArtifacts(mission.id).map((a) => a.path.split('/').pop())
      expect(names).toContain('diff-summary.md')
      expect(names).toContain('done-report.md')
      expect(names).toContain('changed-paths.json')
    } finally {
      db.close()
    }
  })

  it('demotes raw coder/debug dumps from the validator bundle (kept on disk, not fed to validators)', () => {
    const missionDir = join(root, 'mission')
    writeWorkerEvidence(missionDir)
    // a hallucinated coder self-report + a debug log on disk
    writeFileSync(join(missionDir, 'claude-docker-raw.json'), JSON.stringify({ files_changed: ['tests/WRONG_NAME.py'] }))
    writeFileSync(join(missionDir, 'stdout.log'), 'noise')

    const bundle = readEvidenceBundle(missionDir)

    // demoted (excluded) from the validators' view so they can't contradict the git diff...
    expect(bundle['claude-docker-raw.json']).toBeUndefined()
    expect(bundle['stdout.log']).toBeUndefined()
    // ...but kept on disk for provenance (demote, not hide)
    expect(existsSync(join(missionDir, 'claude-docker-raw.json'))).toBe(true)
    // curated git-truth evidence still present
    expect(bundle['diff-summary.md']).toContain('test_readme_artifacts.py')
  })
})
