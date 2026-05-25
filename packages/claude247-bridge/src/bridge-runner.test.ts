/**
 * Real-behavior tests for Claude247BridgeRunner — exercises the full flow:
 * aedev Task → Bridge.enqueue → poll list → poll detail → import evidence →
 * RunResult written into aedev's evidence dir.  Uses a fake `claude247`
 * binary and an injected no-op sleepFn so the test runs in milliseconds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, chmodSync, mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Task, RunnerConfig } from '@aedev/core'
import { Claude247Bridge } from './bridge.js'
import { Claude247BridgeRunner } from './bridge-runner.js'

let tmpRoot: string
let homeDir: string
let workDir: string

function makeTask(id = 'aedev-task-001'): Task {
  return {
    id,
    missionId: 'aedev-mission-001',
    repoId: 'repo-x',
    title: 'Test bridge task',
    prompt: 'do something via claude247',
    status: 'pending',
    attemptNumber: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeConfig(root: string): RunnerConfig {
  return {
    mode: 'claude247-bridge',
    maxConcurrentWorkers: 1,
    worktreeBaseDir: join(root, 'worktrees'),
    outputBaseDir: join(root, 'output'),
  }
}

/**
 * Writes a fake claude247 binary that respects the goal-prefix correlation
 * convention: when `tasks` is called, it emits a task whose `goal` field
 * is taken from a file at $TMPROOT/last-goal.txt (so the runner can correlate
 * by prefix).  When `start` is called, it captures the goal arg into that
 * file.
 */
function writeFakeBin(path: string, terminalStatus: string): void {
  const tmp = join(tmpRoot, 'last-goal.txt')
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      `LAST_GOAL_FILE="${tmp}"`,
      'case "$1" in',
      '  start)',
      // claude247 start --repo X --goal "..." --json [--source aedev] [--source-ref Y]
      '    GOAL=""',
      '    while [ "$#" -gt 0 ]; do',
      '      case "$1" in',
      '        --goal) GOAL="$2"; shift 2 ;;',
      '        *) shift ;;',
      '      esac',
      '    done',
      `    printf "%s" "$GOAL" > "$LAST_GOAL_FILE"`,
      `    echo '{"command_id":"cmd-001","status":"queued","queued_at":"2026-05-25T10:00:00Z"}'`,
      '    ;;',
      '  tasks)',
      '    GOAL_VAL="$(cat "$LAST_GOAL_FILE" 2>/dev/null)"',
      `    echo '[{"id":"py-task-001","repo":"repo-x","status":"${terminalStatus}","goal":"'$GOAL_VAL'","branch":"feat/x","pr":42,"created_at":"2026-05-25T10:00:01Z"}]'`,
      '    ;;',
      '  task)',
      '    GOAL_VAL="$(cat "$LAST_GOAL_FILE" 2>/dev/null)"',
      `    echo '{"id":"'$2'","repo":"repo-x","status":"${terminalStatus}","goal":"'$GOAL_VAL'","branch":"feat/x","pr":42,"created_at":"2026-05-25T10:00:01Z","updated_at":"2026-05-25T10:05:00Z","finished_at":"2026-05-25T10:05:00Z","risk_score":12,"events":[]}'`,
      '    ;;',
      'esac',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(path, 0o755)
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aedev-bridge-runner-test-'))
  homeDir = join(tmpRoot, 'home')
  workDir = join(tmpRoot, 'work')
  mkdirSync(workDir, { recursive: true })

  // Pre-populate evidence under homeDir for py-task-001
  const evDir = join(homeDir, 'workspaces', 'py-task-001', '.evidence')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(join(evDir, 'plan.md'), '# Plan from claude247\n')
  writeFileSync(join(evDir, 'diff.patch'), 'diff content\n')
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('Claude247BridgeRunner — happy path (Python kernel returned `merged`)', () => {
  it('enqueues, polls, imports evidence, and returns exitCode 0 on merge', async () => {
    const bin = join(tmpRoot, 'fake-claude247-merge.sh')
    writeFakeBin(bin, 'merged')
    const bridge = new Claude247Bridge({ claude247Bin: bin, homeDir })
    const runner = new Claude247BridgeRunner(bridge, { sleepFn: async () => {} })

    const task = makeTask('aedev-success')
    const config = makeConfig(workDir)
    const result = await runner.run(task, config)

    expect(result.taskId).toBe('aedev-success')
    expect(result.exitCode).toBe(0)
    expect(result.evidenceDir).toBe(join(config.outputBaseDir, 'aedev-success'))
    expect(result.runId.length).toBeGreaterThan(0)

    // Bridge metadata
    const meta = JSON.parse(readFileSync(join(result.evidenceDir, 'bridge-meta.json'), 'utf-8')) as Record<string, unknown>
    expect(meta['bridge']).toBe('claude247')
    expect(meta['aedevTaskId']).toBe('aedev-success')
    expect(meta['commandId']).toBe('cmd-001')
    expect(meta['claude247TaskId']).toBe('py-task-001')
    expect((meta['goalPrefix'] as string)).toBe('[aedev:aedev-success]')

    // Bridge final report
    const final = JSON.parse(readFileSync(join(result.evidenceDir, 'bridge-final.json'), 'utf-8')) as Record<string, unknown>
    expect(final['claude247TaskId']).toBe('py-task-001')
    expect(final['finalStatus']).toBe('merged')
    expect(final['riskScore']).toBe(12)

    // Imported evidence from claude247 workspace
    expect(existsSync(join(result.evidenceDir, 'claude247-plan.md'))).toBe(true)
    expect(existsSync(join(result.evidenceDir, 'claude247-diff.patch'))).toBe(true)
    const importedPlan = readFileSync(join(result.evidenceDir, 'claude247-plan.md'), 'utf-8')
    expect(importedPlan).toContain('# Plan from claude247')
  })
})

describe('Claude247BridgeRunner — failure paths', () => {
  it('returns exitCode 1 when Python task ends in `failed`', async () => {
    const bin = join(tmpRoot, 'fake-claude247-fail.sh')
    writeFakeBin(bin, 'failed')
    const bridge = new Claude247Bridge({ claude247Bin: bin, homeDir })
    const runner = new Claude247BridgeRunner(bridge, { sleepFn: async () => {} })

    const task = makeTask('aedev-failed')
    const config = makeConfig(workDir)
    const result = await runner.run(task, config)

    expect(result.exitCode).toBe(1)
    const final = JSON.parse(readFileSync(join(result.evidenceDir, 'bridge-final.json'), 'utf-8')) as Record<string, unknown>
    expect(final['finalStatus']).toBe('failed')
  })

  it('returns exitCode 1 when the task cannot be located within findTimeoutMs', async () => {
    // Fake CLI that returns an empty task list for `tasks` (so no match by goal prefix).
    const bin = join(tmpRoot, 'fake-claude247-notfound.sh')
    writeFileSync(
      bin,
      [
        '#!/bin/sh',
        'case "$1" in',
        '  start)',
        `    echo '{"command_id":"c","status":"queued","queued_at":"t"}'`,
        '    ;;',
        '  tasks)',
        '    echo "[]"',
        '    ;;',
        '  task)',
        '    echo "{}" 1>&2; exit 1',
        '    ;;',
        'esac',
        'exit 0',
      ].join('\n') + '\n',
    )
    chmodSync(bin, 0o755)
    const bridge = new Claude247Bridge({ claude247Bin: bin, homeDir })
    const runner = new Claude247BridgeRunner(bridge, {
      sleepFn: async () => {},
      findTimeoutMs: 50,  // give up almost immediately
      pollIntervalMs: 10,
    })

    const task = makeTask('aedev-notfound')
    const config = makeConfig(workDir)
    const result = await runner.run(task, config)

    expect(result.exitCode).toBe(1)
    const errPath = join(result.evidenceDir, 'bridge-error.txt')
    expect(existsSync(errPath)).toBe(true)
    expect(readFileSync(errPath, 'utf-8')).toContain('Failed to locate')
  })
})
