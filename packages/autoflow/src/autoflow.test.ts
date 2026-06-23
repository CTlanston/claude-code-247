import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildClaudeArgs,
  buildCodexArgs,
  commandContainsRemoteWrite,
  defaultConfig,
  loadState,
  pathMatches,
  planRemoteWriteStage,
  runAutoflow,
  runOneCycle,
  saveState,
  scrubRemoteWriteEnv,
  shouldBlockRemoteWrite,
  type AutoflowConfig,
  type CommandResult,
  type CommandRunner,
} from './index.js'

class FakeRunner implements CommandRunner {
  calls: Array<{ command: string; args: string[]; stdin?: string }> = []
  codexCalls = 0
  claudeDone = false

  constructor(private readonly opts: {
    codexFailures?: number
    gateFailures?: number
    changedPaths?: string[]
    remoteChangedPaths?: string[]
    failRemoteWrite?: boolean
    claudeWorkbookContent?: string
  } = {}) {}

  async run(command: string, args: string[], callOpts: { cwd: string; timeoutMs: number; stdin?: string }): Promise<CommandResult> {
    this.calls.push({ command, args, stdin: callOpts.stdin })
    const rendered = [command, ...args].join(' ')
    if (rendered.includes('rev-parse HEAD')) return result(command, args, callOpts.cwd, 'base-sha\n')
    if (rendered.includes('fetch origin main')) return result(command, args, callOpts.cwd)
    if (rendered.includes('diff --name-only origin/main...HEAD')) {
      return result(command, args, callOpts.cwd, (this.opts.remoteChangedPaths ?? []).join('\n') + '\n')
    }
    if (rendered.includes('diff --name-only')) return result(command, args, callOpts.cwd, '')
    if (rendered.includes('status --porcelain')) {
      const paths = this.codexCalls === 0 && this.claudeDone
        ? ['WORKBOOK_v4.md']
        : this.opts.changedPaths ?? ['src/example.ts']
      return result(command, args, callOpts.cwd, paths.map((p) => ` M ${p}`).join('\n') + '\n')
    }
    if (command === 'claude') {
      this.claudeDone = true
      if (this.opts.claudeWorkbookContent) {
        writeFileSync(join(callOpts.cwd, 'WORKBOOK_v4.md'), this.opts.claudeWorkbookContent)
      }
      return result(command, args, callOpts.cwd, '{"result":"implement the next workbook step"}\n')
    }
    if (command === 'codex') {
      this.codexCalls++
      const fail = this.codexCalls <= (this.opts.codexFailures ?? 0)
      return result(command, args, callOpts.cwd, '{"msg":"codex"}\n', '', fail ? 1 : 0)
    }
    if (command === '/bin/sh') {
      const gateFail = this.calls.filter((c) => c.command === '/bin/sh').length <= (this.opts.gateFailures ?? 0)
      return result(command, args, callOpts.cwd, gateFail ? '' : 'ok\n', gateFail ? 'failed\n' : '', gateFail ? 1 : 0)
    }
    if (rendered.includes('git add')) return result(command, args, callOpts.cwd)
    if (rendered.includes('git -c user.name')) return result(command, args, callOpts.cwd)
    if (rendered.includes('rev-parse HEAD')) return result(command, args, callOpts.cwd, 'commit-sha\n')
    if (rendered.includes('git push')) return result(command, args, callOpts.cwd, 'pushed\n', this.opts.failRemoteWrite ? 'push failed\n' : '', this.opts.failRemoteWrite ? 1 : 0)
    if (rendered.includes('gh pr create')) return result(command, args, callOpts.cwd, 'https://github.com/example/repo/pull/1\n')
    if (rendered.includes('gh pr merge')) return result(command, args, callOpts.cwd, 'merged\n')
    return result(command, args, callOpts.cwd)
  }
}

class SetupFailRunner implements CommandRunner {
  async run(command: string, args: string[], callOpts: { cwd: string }): Promise<CommandResult> {
    return result(command, args, callOpts.cwd, '', 'missing cli\n', 1)
  }
}

describe('autoflow state', () => {
  it('loads a default state and saves recovered state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-state-'))
    const config = testConfig(dir)
    const initial = loadState(config)
    expect(initial.nextCycle).toBe(1)
    saveState(config, { ...initial, nextCycle: 7, seeded: true })
    expect(loadState(config).nextCycle).toBe(7)
    expect(loadState(config).seeded).toBe(true)
  })
})

describe('autoflow command builders', () => {
  it('defaults remote writes off unless explicitly enabled', () => {
    expect(defaultConfig({}, []).allowRemoteWrites).toBe(false)
    expect(defaultConfig({ AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES: '1' }, []).allowRemoteWrites).toBe(true)
    expect(defaultConfig({ AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES: 'true' }, []).allowRemoteWrites).toBe(true)
    expect(defaultConfig({ AEDEV_AUTOFLOW_ROTATE_REMOTE_BRANCHES: '1' }, []).rotateRemoteBranches).toBe(true)
    expect(defaultConfig({ AEDEV_AUTOFLOW_SETUP_COMMANDS: 'npm install||npm test' }, []).setupCommands).toEqual(['npm install', 'npm test'])
  })

  it('builds Claude and Codex commands without remote-write operations', () => {
    const config = defaultConfig({}, [])
    expect(buildClaudeArgs(config).join(' ')).toContain('--permission-mode bypassPermissions')
    expect(buildCodexArgs(config).join(' ')).toContain('approval_policy="never"')
    expect(commandContainsRemoteWrite('codex', buildCodexArgs(config))).toBe(false)
    expect(commandContainsRemoteWrite('git', ['push', 'origin', 'main'])).toBe(true)
    expect(commandContainsRemoteWrite('gh', ['pr', 'create'])).toBe(true)
  })

  it('blocks remote-write commands unless the supervisor enables them', () => {
    expect(shouldBlockRemoteWrite('git', ['push', 'origin', 'main'], false)).toBe(true)
    expect(shouldBlockRemoteWrite('git', ['push', 'origin', 'main'], true)).toBe(false)
    expect(shouldBlockRemoteWrite('git', ['status'], false)).toBe(false)
  })

  it('scrubs remote-write credentials unless the supervisor enables them', () => {
    const blocked = scrubRemoteWriteEnv({ GITHUB_TOKEN: 'github', GH_TOKEN: 'gh' }, false)
    expect(blocked.AEDEV_ALLOW_REMOTE_WRITES).toBe('0')
    expect(blocked.GITHUB_TOKEN).toBeUndefined()
    expect(blocked.GH_TOKEN).toBeUndefined()

    const allowed = scrubRemoteWriteEnv({ GITHUB_TOKEN: 'github', GH_TOKEN: 'gh' }, true)
    expect(allowed.AEDEV_ALLOW_REMOTE_WRITES).toBe('1')
    expect(allowed.GITHUB_TOKEN).toBe('github')
    expect(allowed.GH_TOKEN).toBe('gh')
  })

  it('matches forbidden paths', () => {
    expect(pathMatches('.env*', '.env.local')).toBe(true)
    expect(pathMatches('secrets/**', 'secrets/prod/key')).toBe(true)
    expect(pathMatches('AGENTS.md', 'AGENTS.md')).toBe(true)
    expect(pathMatches('.github/**', 'src/index.ts')).toBe(false)
  })
})

describe('autoflow remote-write policy', () => {
  it('keeps the post-gate remote stage off by default', () => {
    const config = defaultConfig({}, [])
    const plan = planRemoteWriteStage(config, ['src/example.ts'], [{ command: 'pnpm test', exitCode: 0, stdout: '', stderr: '' }])
    expect(plan.allowed).toBe(false)
    expect(plan.reason).toContain('remote stage disabled')
  })

  it('allows low-risk PR creation only when remote writes and PR mode are enabled', () => {
    const config = {
      ...defaultConfig({ AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES: '1', AEDEV_AUTOFLOW_REMOTE_MODE: 'pr' }, []),
      forbiddenPatterns: ['.env*', 'secrets/**', '.github/**'],
    }
    const plan = planRemoteWriteStage(config, ['src/example.ts'], [{ command: 'pnpm test', exitCode: 0, stdout: '', stderr: '' }])
    expect(plan).toMatchObject({ allowed: true, mode: 'pr' })
  })

  it('allows auto-merge only for low-risk green changes when explicitly requested', () => {
    const config = {
      ...defaultConfig({ AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES: '1', AEDEV_AUTOFLOW_REMOTE_MODE: 'pr-merge' }, []),
      forbiddenPatterns: ['.env*', 'secrets/**', '.github/**'],
    }
    const plan = planRemoteWriteStage(config, ['src/example.ts'], [{ command: 'pnpm test', exitCode: 0, stdout: '', stderr: '' }])
    expect(plan).toMatchObject({ allowed: true, mode: 'pr-merge' })
  })

  it('blocks remote writes for failing gates, forbidden paths, and medium-risk paths', () => {
    const config = {
      ...defaultConfig({ AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES: '1', AEDEV_AUTOFLOW_REMOTE_MODE: 'pr-merge' }, []),
      forbiddenPatterns: ['.env*', 'secrets/**', '.github/**'],
    }
    expect(planRemoteWriteStage(config, ['src/example.ts'], [{ command: 'pnpm test', exitCode: 1, stdout: '', stderr: '' }]).allowed).toBe(false)
    expect(planRemoteWriteStage(config, ['.env.local'], [{ command: 'pnpm test', exitCode: 0, stdout: '', stderr: '' }]).allowed).toBe(false)
    expect(planRemoteWriteStage(config, ['package.json'], [{ command: 'pnpm test', exitCode: 0, stdout: '', stderr: '' }]).allowed).toBe(false)
    expect(planRemoteWriteStage(config, ['scripts/browser-smoke.ts'], [{ command: 'pnpm test', exitCode: 0, stdout: '', stderr: '' }]).allowed).toBe(false)
    expect(planRemoteWriteStage(config, ['docs/smoke.md'], [{ command: 'pnpm test', exitCode: 0, stdout: '', stderr: '' }]).allowed).toBe(false)
  })
})

describe('autoflow cycle controls', () => {
  it('writes HOLD instead of crash-looping when setup fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-setup-'))
    const config = testConfig(dir)
    const results = await runAutoflow(config, new SetupFailRunner())
    expect(results[0]?.status).toBe('hold')
    expect(loadState(config).hold?.code).toBe('SETUP_FAILED')
  })

  it('retries Codex up to the configured limit before committing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-cycle-'))
    const config = seededConfig(dir)
    const runner = new FakeRunner({ codexFailures: 2, changedPaths: ['src/example.ts'] })
    const result = await runOneCycle(config, runner, loadState(config))
    expect(result.status).toBe('completed')
    expect(runner.codexCalls).toBe(3)
  })

  it('logs stage events around Claude, Codex, and gates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-stage-events-'))
    const config = seededConfig(dir)
    await runOneCycle(config, new FakeRunner({ changedPaths: ['src/example.ts'] }), loadState(config))
    const eventTypes = readFileSync(config.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string })
      .map((event) => event.type)
    expect(eventTypes).toContain('autoflow.claude_started')
    expect(eventTypes).toContain('autoflow.claude_completed')
    expect(eventTypes).toContain('autoflow.codex_started')
    expect(eventTypes).toContain('autoflow.codex_completed')
    expect(eventTypes).toContain('autoflow.gates_started')
    expect(eventTypes).toContain('autoflow.gates_completed')
  })

  it('passes previous cycle evidence and state into the Claude planning prompt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-prompt-evidence-'))
    const config = seededConfig(dir)
    const state = {
      ...loadState(config),
      nextCycle: 7,
      lastCommitSha: 'previous-sha',
      lastCompletedAt: '2026-06-23T02:13:52.994Z',
    }
    saveState(config, state)
    const runner = new FakeRunner({ changedPaths: ['src/example.ts'] })
    await runOneCycle(config, runner, state)
    const claudeCall = runner.calls.find((call) => call.command === 'claude')
    expect(claudeCall?.stdin).toContain(`Previous cycle evidence dir: ${join(config.evidenceDir, 'cycle-000006')}`)
    expect(claudeCall?.stdin).toContain('Previous cycle commit: previous-sha')
    expect(claudeCall?.stdin).toContain('Previous cycle completed at: 2026-06-23T02:13:52.994Z')
  })

  it('pushes and creates a PR after green low-risk changes when PR mode is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-pr-'))
    const config = {
      ...seededConfig(dir),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    const runner = new FakeRunner({ changedPaths: ['src/example.ts'] })
    const result = await runOneCycle(config, runner, loadState(config))
    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '))
    expect(result.status).toBe('completed')
    expect(commands).toContain('git push -u origin codex/autoflow-workbook')
    expect(commands.some((command) => command.startsWith('gh pr create '))).toBe(true)
    expect(commands.some((command) => command.startsWith('gh pr merge '))).toBe(false)
  })

  it('does not commit workbook artifacts into remote PR branches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-no-workbook-'))
    const config = {
      ...seededConfig(dir),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    const runner = new FakeRunner({ changedPaths: ['WORKBOOK_v4.md', 'src/example.ts'] })
    const result = await runOneCycle(config, runner, loadState(config))
    const gitAdd = runner.calls.find((call) => call.command === 'git' && call.args[0] === 'add')
    expect(result.status).toBe('completed')
    expect(gitAdd?.args).toContain('src/example.ts')
    expect(gitAdd?.args).not.toContain('WORKBOOK_v4.md')
  })

  it('persists Claude workbook updates back to the seed workbook', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-workbook-sync-'))
    const config = seededConfig(dir)
    const nextWorkbook = '# workbook\n\nnext_action: keep moving\n'
    const result = await runOneCycle(
      config,
      new FakeRunner({ changedPaths: ['WORKBOOK_v4.md', 'src/example.ts'], claudeWorkbookContent: nextWorkbook }),
      loadState(config),
    )
    const syncEvidence = JSON.parse(readFileSync(join(config.evidenceDir, 'cycle-000001', 'workbook-sync.json'), 'utf8')) as { changed: boolean }
    expect(result.status).toBe('completed')
    expect(readFileSync(config.workbookPath, 'utf8')).toBe(nextWorkbook)
    expect(syncEvidence.changed).toBe(true)
  })

  it('merges the PR only when pr-merge mode is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-merge-'))
    const config = {
      ...seededConfig(dir),
      allowRemoteWrites: true,
      remoteMode: 'pr-merge' as const,
    }
    const runner = new FakeRunner({ changedPaths: ['src/example.ts'] })
    const result = await runOneCycle(config, runner, loadState(config))
    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '))
    expect(result.status).toBe('completed')
    expect(commands.some((command) => command.startsWith('gh pr merge '))).toBe(true)
  })

  it('rotates to a fresh branch and worktree after a successful remote merge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-rotate-'))
    const config = {
      ...seededConfig(dir),
      allowRemoteWrites: true,
      remoteMode: 'pr-merge' as const,
      rotateRemoteBranches: true,
    }
    const result = await runOneCycle(config, new FakeRunner({ changedPaths: ['src/example.ts'] }), loadState(config))
    const nextState = loadState(config)
    expect(result.status).toBe('completed')
    expect(nextState.nextCycle).toBe(2)
    expect(nextState.branch).toBe('codex/autoflow-workbook-cycle-000002')
    expect(nextState.worktreePath).toBe(join(dir, 'worktree-cycle-000002'))
  })

  it('rotates from an already rotated branch without stacking cycle suffixes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-rotate-again-'))
    const baseConfig = seededConfig(dir)
    const config = {
      ...baseConfig,
      branch: 'codex/autoflow-workbook-cycle-000002',
      worktreePath: join(dir, 'worktree-cycle-000002'),
      allowRemoteWrites: true,
      remoteMode: 'pr-merge' as const,
      rotateRemoteBranches: true,
    }
    const state = {
      ...loadState(baseConfig),
      nextCycle: 2,
      branch: config.branch,
      worktreePath: config.worktreePath,
    }
    saveState(baseConfig, state)
    const result = await runOneCycle(config, new FakeRunner({ changedPaths: ['src/example.ts'] }), state)
    const nextState = loadState(baseConfig)
    expect(result.status).toBe('completed')
    expect(nextState.nextCycle).toBe(3)
    expect(nextState.branch).toBe('codex/autoflow-workbook-cycle-000003')
    expect(nextState.worktreePath).toBe(join(dir, 'worktree-cycle-000003'))
  })

  it('holds instead of remote-writing when PR mode is enabled but policy blocks the change', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-policy-'))
    const config = {
      ...seededConfig(dir),
      allowRemoteWrites: true,
      remoteMode: 'pr-merge' as const,
    }
    const runner = new FakeRunner({ changedPaths: ['package.json'] })
    const result = await runOneCycle(config, runner, loadState(config))
    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '))
    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('REMOTE_WRITE_POLICY_BLOCKED')
    expect(commands.some((command) => command.includes('git push'))).toBe(false)
  })

  it('holds when the full branch diff contains risky paths even if the current cycle is low-risk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-branch-risk-'))
    const config = {
      ...seededConfig(dir),
      allowRemoteWrites: true,
      remoteMode: 'pr-merge' as const,
    }
    const runner = new FakeRunner({ changedPaths: ['src/example.ts'], remoteChangedPaths: ['package.json'] })
    const result = await runOneCycle(config, runner, loadState(config))
    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '))
    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('REMOTE_WRITE_POLICY_BLOCKED')
    expect(commands.some((command) => command.includes('git push'))).toBe(false)
  })

  it('holds when a remote-write command fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-fail-'))
    const config = {
      ...seededConfig(dir),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    const result = await runOneCycle(config, new FakeRunner({ changedPaths: ['src/example.ts'], failRemoteWrite: true }), loadState(config))
    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('REMOTE_WRITE_FAILED')
  })

  it('holds when a forbidden path is touched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-forbidden-'))
    const config = seededConfig(dir)
    const result = await runOneCycle(config, new FakeRunner({ changedPaths: ['.env.local'] }), loadState(config))
    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('FORBIDDEN_PATH_TOUCHED')
  })

  it('holds after repeated empty diffs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-empty-'))
    const config = seededConfig(dir)
    const state = { ...loadState(config), consecutiveEmptyDiffs: 2 }
    saveState(config, state)
    const runner = new FakeRunner({ changedPaths: [] })
    const result = await runOneCycle(config, runner, state)
    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('EMPTY_DIFF_STREAK')
  })

  it('holds after repeated workbook-only diffs because they are not productive changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-workbook-only-'))
    const config = seededConfig(dir)
    const state = { ...loadState(config), consecutiveNoProductiveChanges: 2 }
    saveState(config, state)
    const runner = new FakeRunner({ changedPaths: ['WORKBOOK_v4.md'] })
    const result = await runOneCycle(config, runner, state)
    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('NO_PRODUCTIVE_CHANGE')
  })
})

function result(command: string, args: string[], cwd: string, stdout = '', stderr = '', exitCode = 0): CommandResult {
  return { command, args, cwd, stdout, stderr, exitCode, durationMs: 1 }
}

function testConfig(dir: string): AutoflowConfig {
  mkdirSync(join(dir, 'repo'), { recursive: true })
  mkdirSync(join(dir, 'worktree'), { recursive: true })
  writeFileSync(join(dir, 'repo', 'WORKBOOK_v4.md'), '# workbook\n')
  return {
    repoRoot: join(dir, 'repo'),
    workbookPath: join(dir, 'repo', 'WORKBOOK_v4.md'),
    homeDir: dir,
    worktreePath: join(dir, 'worktree'),
    branch: 'codex/autoflow-workbook',
    statePath: join(dir, 'state.json'),
    logPath: join(dir, 'logs', 'autoflow.jsonl'),
    evidenceDir: join(dir, 'evidence'),
    claudeBin: 'claude',
    codexBin: 'codex',
    pnpmBin: 'pnpm',
    ghBin: 'gh',
    claudeEffort: 'high',
    codexConfig: [],
    setupCommands: [],
    gateCommands: ['pnpm typecheck'],
    forbiddenPatterns: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    maxCycles: 1,
    maxCodexRetries: 3,
    holdAfterConsecutiveFailures: 3,
    holdAfterConsecutiveEmptyDiffs: 3,
    commandTimeoutMs: 1000,
    cycleSleepMs: 0,
    allowRemoteWrites: false,
    remoteMode: 'off',
    remoteName: 'origin',
    prBaseBranch: 'main',
    rotateRemoteBranches: false,
  }
}

function seededConfig(dir: string): AutoflowConfig {
  const config = testConfig(dir)
  writeFileSync(join(config.worktreePath, 'WORKBOOK_v4.md'), readFileSync(config.workbookPath, 'utf8'))
  saveState(config, { ...loadState(config), seeded: true })
  return config
}
