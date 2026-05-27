/**
 * Real-behavior tests for Claude247Bridge.
 *
 * Uses a fake `claude247` shell script in a temp directory so the full
 * subprocess pipeline (spawn → parse JSON → typed result) is exercised
 * without requiring the Python CLI on the test machine.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, chmodSync, mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Claude247Bridge } from './bridge.js'

let tmpRoot: string
let fakeBin: string
let fakeBinErr: string
let fakeHome: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aedev-claude247-bridge-test-'))

  // Fake claude247 dispatches on $1.
  fakeBin = join(tmpRoot, 'fake-claude247.sh')
  writeFileSync(
    fakeBin,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  start)',
      `    echo '{"command_id":"cmd-fake-001","status":"queued","queued_at":"2026-05-25T10:00:00Z"}'`,
      '    ;;',
      '  tasks)',
      `    echo '[{"id":"py-task-001","repo":"repo-x","status":"merged","goal":"[aedev:aedev-001] do something","branch":"feat/x","pr":42,"created_at":"2026-05-25T10:00:01Z"}]'`,
      '    ;;',
      '  task)',
      `    echo '{"id":"'$2'","repo":"repo-x","status":"merged","goal":"[aedev:aedev-001] do something","branch":"feat/x","pr":42,"created_at":"2026-05-25T10:00:01Z","updated_at":"2026-05-25T10:05:00Z","finished_at":"2026-05-25T10:05:00Z","risk_score":12,"events":[{"kind":"task.created"}]}'`,
      '    ;;',
      '  *)',
      '    echo "unknown subcommand: $1" 1>&2',
      '    exit 1',
      '    ;;',
      'esac',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(fakeBin, 0o755)

  // Fake claude247 that always fails — used for getTask(non-existent).
  fakeBinErr = join(tmpRoot, 'fake-claude247-err.sh')
  writeFileSync(
    fakeBinErr,
    ['#!/bin/sh', 'echo "task not found" 1>&2', 'exit 1'].join('\n') + '\n',
  )
  chmodSync(fakeBinErr, 0o755)

  // Fake home dir with an evidence bundle.
  fakeHome = join(tmpRoot, 'home')
  const evidenceDir = join(fakeHome, 'workspaces', 'py-task-001', '.evidence')
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, 'plan.md'), '# Plan\n\nDo the thing.\n')
  writeFileSync(join(evidenceDir, 'diff.patch'), '--- a/x\n+++ b/x\n')
  writeFileSync(join(evidenceDir, 'test-summary.md'), '# Tests\n\n3 passed.\n')
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('Claude247Bridge — subprocess interop', () => {
  it('enqueue() returns commandId/status/queuedAt from claude247 start --json', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBin, homeDir: fakeHome })
    const result = await bridge.enqueue('repo-x', 'do something', { sourceRef: 'aedev-001' })

    expect(result.commandId).toBe('cmd-fake-001')
    expect(result.status).toBe('queued')
    expect(result.queuedAt).toBe('2026-05-25T10:00:00Z')
  })

  it('listTasks() parses the JSON array and maps snake_case to camelCase', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBin, homeDir: fakeHome })
    const tasks = await bridge.listTasks({ repoId: 'repo-x', limit: 10 })

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe('py-task-001')
    expect(tasks[0]?.status).toBe('merged')
    expect(tasks[0]?.goal).toContain('[aedev:aedev-001]')
    expect(tasks[0]?.createdAt).toBe('2026-05-25T10:00:01Z')
    expect(tasks[0]?.pr).toBe(42)
  })

  it('getTask() returns a full detail with events timeline', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBin, homeDir: fakeHome })
    const detail = await bridge.getTask('py-task-001')

    expect(detail).not.toBeNull()
    expect(detail?.id).toBe('py-task-001')
    expect(detail?.status).toBe('merged')
    expect(detail?.riskScore).toBe(12)
    expect(detail?.updatedAt).toBe('2026-05-25T10:05:00Z')
    expect(detail?.finishedAt).toBe('2026-05-25T10:05:00Z')
    expect(detail?.events).toHaveLength(1)
    expect(detail?.events[0]?.['kind']).toBe('task.created')
  })

  it('getTask() returns null when the CLI exits non-zero', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBinErr, homeDir: fakeHome })
    const detail = await bridge.getTask('does-not-exist')
    expect(detail).toBeNull()
  })

  it('readEvidence() reads all files from <home>/workspaces/<id>/.evidence/', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBin, homeDir: fakeHome })
    const ev = await bridge.readEvidence('py-task-001')

    expect(Object.keys(ev).sort()).toEqual(['diff.patch', 'plan.md', 'test-summary.md'])
    expect(ev['plan.md']).toContain('# Plan')
    expect(ev['diff.patch']).toContain('+++ b/x')
  })

  it('readEvidence() returns an empty record when the workspace does not exist', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBin, homeDir: fakeHome })
    const ev = await bridge.readEvidence('no-such-task')
    expect(ev).toEqual({})
  })

  it('isAvailable() returns false when the binary is missing', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: '/no/such/claude247', homeDir: fakeHome })
    expect(await bridge.isAvailable()).toBe(false)
  })

  it('isAvailable() returns true when the binary resolves', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBin, homeDir: fakeHome })
    expect(await bridge.isAvailable()).toBe(true)
  })

  it('getHomeDir() returns the configured home', async () => {
    const bridge = new Claude247Bridge({ claude247Bin: fakeBin, homeDir: fakeHome })
    expect(bridge.getHomeDir()).toBe(fakeHome)
  })
})

// allow-skip: env-gated smoke runner — only fires under AEDEV_SMOKE_CLAUDE247=1
const smokeRunner = process.env['AEDEV_SMOKE_CLAUDE247'] === '1' ? describe : describe.skip

smokeRunner('Claude247Bridge — smoke against real claude247 CLI (opt-in)', () => {
  it('isAvailable returns true when claude247 is installed', async () => {
    const bridge = new Claude247Bridge()
    expect(await bridge.isAvailable()).toBe(true)
  })

  it('listTasks succeeds against the real claude247 state DB', async () => {
    const bridge = new Claude247Bridge()
    const tasks = await bridge.listTasks({ limit: 5 })
    // Either zero tasks (clean state) or a real list — both are valid.
    expect(Array.isArray(tasks)).toBe(true)
  })
})
