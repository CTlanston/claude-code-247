import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyIntakeBatch,
  classifyIntakeCandidate,
  MissionIntakeSource,
  scanFailingTestCandidates,
  scanGitHubIssueCandidates,
  scanTodoCandidates,
  type IntakeCandidate,
} from './mission-intake-source.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('classifyIntakeCandidate', () => {
  it('executes low-risk manual and auto-labeled issue candidates', () => {
    expect(classifyIntakeCandidate({
      id: 'm1',
      source: 'manual',
      title: 'Fix typo',
      body: 'Small docs polish.',
    }).decision).toBe('execute_now')

    expect(classifyIntakeCandidate({
      id: 'i1',
      source: 'github-issue',
      title: 'Fix dashboard copy',
      body: 'Low risk.',
      labels: ['aedev:auto'],
    }).decision).toBe('execute_now')
  })

  it('turns noisy or sensitive candidates into proposals', () => {
    expect(classifyIntakeCandidate({
      id: 'todo1',
      source: 'todo',
      title: 'TODO clean this up',
      body: 'Refactor later.',
    }).decision).toBe('proposal_only')

    expect(classifyIntakeCandidate({
      id: 'issue1',
      source: 'github-issue',
      title: 'Change auth policy',
      body: 'Touches tokens.',
      labels: ['aedev:auto'],
    }).decision).toBe('proposal_only')
  })

  it('blocks destructive or secret-touching candidates', () => {
    expect(classifyIntakeCandidate({
      id: 'bad1',
      source: 'manual',
      title: 'Drop table',
      body: 'DELETE FROM event_log and read secrets/foo.',
    }).decision).toBe('blocked')
  })
})

describe('classifyIntakeBatch', () => {
  it('caps flood input and reports overflow', async () => {
    const candidates: IntakeCandidate[] = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      source: 'manual',
      title: `Task ${i}`,
      body: 'Safe task.',
    }))

    const out = await classifyIntakeBatch('task-1', candidates, { cap: 2 })

    expect(out.accepted).toHaveLength(2)
    expect(out.overflow).toHaveLength(2)
  })
})

describe('source scanners', () => {
  it('scans GitHub issues into intake candidates', async () => {
    const candidates = await scanGitHubIssueCandidates({
      owner: 'acme',
      repo: 'widget',
      repoId: 'repo-1',
      listIssues: async () => [{
        number: 42,
        title: 'Fix dashboard bug',
        body: 'This should get auto-triaged.',
        url: 'https://github.com/acme/widget/issues/42',
        labels: ['aedev:auto'],
      }],
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.source).toBe('github-issue')
    expect(candidates[0]?.title).toContain('Fix dashboard bug')
  })

  it('scans TODO markers from repo files', () => {
    const repoPath = makeTempRepo('todo-scan')
    writeFileSync(join(repoPath, 'src.ts'), 'const x = 1\n// TODO: tighten null handling\n')
    writeFileSync(join(repoPath, 'README.md'), 'FIXME document edge cases\n')

    const candidates = scanTodoCandidates({ repoPath, repoId: 'repo-1', limit: 10 })

    expect(candidates).toHaveLength(2)
    expect(candidates.every((candidate) => candidate.source === 'todo')).toBe(true)
    expect(candidates.map((candidate) => candidate.files?.[0]).sort()).toEqual(['README.md', 'src.ts'])
  })

  it('scans failing tests from vitest JSON output', async () => {
    const repoPath = makeTempRepo('failing-test-scan')
    const candidates = await scanFailingTestCandidates({
      repoPath,
      repoId: 'repo-1',
      runCommand: async () => ({
        exitCode: 1,
        stdout: JSON.stringify({
          testResults: [{
            name: 'packages/core/src/foo.test.ts',
            assertionResults: [{
              status: 'failed',
              title: 'renders the error state',
              ancestorTitles: ['Widget'],
              failureMessages: ['expected true to be false'],
            }],
          }],
        }),
        stderr: '',
      }),
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.source).toBe('failing-test')
    expect(candidates[0]?.title).toContain('Widget > renders the error state')
  })

  it('aggregates mixed sources through MissionIntakeSource', async () => {
    const repoPath = makeTempRepo('aggregate-scan')
    writeFileSync(join(repoPath, 'index.ts'), '// TODO: revisit router fallback\n')

    const source = new MissionIntakeSource({
      taskId: 'task-1',
      cap: 5,
      manual: [{ id: 'manual-1', source: 'manual', title: 'Manual task', body: 'Safe change' }],
      github: {
        owner: 'acme',
        repo: 'widget',
        listIssues: async () => [{
          number: 7,
          title: 'Fix auth policy',
          body: 'Touches auth',
          url: 'https://github.com/acme/widget/issues/7',
          labels: ['aedev:auto'],
        }],
      },
      todo: { repoPath },
    })

    const result = await source.scan()

    expect(result.candidates).toHaveLength(3)
    expect(result.accepted.find((candidate) => candidate.id === 'manual-1')?.decision).toBe('execute_now')
    expect(result.accepted.find((candidate) => candidate.source === 'github-issue')?.decision).toBe('proposal_only')
  })
})

function makeTempRepo(prefix: string): string {
  const dir = join(tmpdir(), `aedev-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}
