import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
  SpawnCommandRunner,
  type AutoflowConfig,
  type CommandResult,
  type CommandRunner,
} from './index.js'

class FakeRunner implements CommandRunner {
  calls: Array<{ command: string; args: string[]; stdin?: string }> = []
  codexCalls = 0
  claudeCalls = 0
  revParseCalls = 0
  claudeDone = false
  coderDone = false

  constructor(private readonly opts: {
    codexFailures?: number
    gateFailures?: number
    changedPaths?: string[]
    remoteChangedPaths?: string[]
    failRemoteWrite?: boolean
    claudeWorkbookContent?: string
    codexFailureStdout?: string
    committedChangedPaths?: string[]
    unstagedChangedPathsAfterCoder?: string[]
    commitFailureStderr?: string
    headSha?: string
    fetchTimeouts?: number
    fetchFailureStderr?: string
    claudeDelayMs?: number
  } = {}) {}

  async run(command: string, args: string[], callOpts: { cwd: string; timeoutMs: number; stdin?: string }): Promise<CommandResult> {
    this.calls.push({ command, args, stdin: callOpts.stdin })
    const rendered = [command, ...args].join(' ')
    if (rendered.includes('rev-parse HEAD')) {
      this.revParseCalls++
      return result(command, args, callOpts.cwd, this.revParseCalls === 1 ? 'base-sha\n' : `${this.opts.headSha ?? 'commit-sha'}\n`)
    }
    if (rendered.includes('fetch origin main')) {
      const fetchCalls = this.calls.filter((call) => [call.command, ...call.args].join(' ').includes('fetch origin main')).length
      if (this.opts.fetchFailureStderr) return result(command, args, callOpts.cwd, '', this.opts.fetchFailureStderr, 1)
      return fetchCalls <= (this.opts.fetchTimeouts ?? 0)
        ? result(command, args, callOpts.cwd, '', 'fetch timed out\n', 124)
        : result(command, args, callOpts.cwd)
    }
    if (rendered.includes('diff --name-only origin/main...HEAD')) {
      return result(command, args, callOpts.cwd, (this.opts.remoteChangedPaths ?? []).join('\n') + '\n')
    }
    if (rendered.includes('diff --name-only')) {
      const paths = this.coderDone ? this.opts.committedChangedPaths ?? [] : []
      return result(command, args, callOpts.cwd, paths.join('\n') + (paths.length > 0 ? '\n' : ''))
    }
    if (rendered.includes('status --porcelain')) {
      const paths = this.coderDone && this.opts.committedChangedPaths
        ? this.opts.unstagedChangedPathsAfterCoder ?? []
        : !this.coderDone && this.claudeDone
        ? ['WORKBOOK_v4.md']
        : this.opts.changedPaths ?? ['src/example.ts']
      return result(command, args, callOpts.cwd, paths.map((p) => ` M ${p}`).join('\n') + '\n')
    }
    if (command === 'claude') {
      this.claudeCalls++
      const isPlanner = this.claudeCalls === 1
      if (isPlanner) this.claudeDone = true
      if (isPlanner && this.opts.claudeWorkbookContent) {
        writeFileSync(join(callOpts.cwd, 'WORKBOOK_v4.md'), this.opts.claudeWorkbookContent)
      }
      if (!isPlanner) this.coderDone = true
      if (this.opts.claudeDelayMs) await delay(this.opts.claudeDelayMs)
      return result(command, args, callOpts.cwd, '{"result":"implement the next workbook step"}\n')
    }
    if (command === 'codex') {
      this.codexCalls++
      const fail = this.codexCalls <= (this.opts.codexFailures ?? 0)
      if (!fail) this.coderDone = true
      return result(command, args, callOpts.cwd, fail ? (this.opts.codexFailureStdout ?? '{"msg":"codex failed"}\n') : '{"msg":"codex"}\n', '', fail ? 1 : 0)
    }
    if (command === '/bin/sh') {
      const gateFail = this.calls.filter((c) => c.command === '/bin/sh').length <= (this.opts.gateFailures ?? 0)
      return result(command, args, callOpts.cwd, gateFail ? '' : 'ok\n', gateFail ? 'failed\n' : '', gateFail ? 1 : 0)
    }
    if (rendered.includes('git add')) return result(command, args, callOpts.cwd)
    if (rendered.includes('git -c user.name')) return result(command, args, callOpts.cwd, '', this.opts.commitFailureStderr ?? '', this.opts.commitFailureStderr ? 1 : 0)
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

class WorktreeCreateRunner extends FakeRunner {
  override async run(command: string, args: string[], callOpts: { cwd: string; timeoutMs: number; stdin?: string }): Promise<CommandResult> {
    if (command === 'git' && args[0] === 'worktree' && args[1] === 'add' && args[2]) {
      mkdirSync(join(args[2], '.git'), { recursive: true })
    }
    return super.run(command, args, callOpts)
  }
}

describe('autoflow state', () => {
  it('loads a default state and saves recovered state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-state-'))
    const config = testConfig(dir)
    const initial = loadState(config)
    expect(initial.status).toBe('idle')
    expect(initial.nextCycle).toBe(1)
    expect(initial.consecutiveSetupFetchTimeouts).toBe(0)
    saveState(config, { ...initial, nextCycle: 7, seeded: true })
    expect(loadState(config).nextCycle).toBe(7)
    expect(loadState(config).seeded).toBe(true)
  })

  it('normalizes legacy completed running states to idle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-state-legacy-running-'))
    const config = testConfig(dir)
    saveState(config, { ...loadState(config), status: 'running', nextCycle: 9, currentCycle: undefined })

    const state = loadState(config)

    expect(state.status).toBe('idle')
    expect(state.nextCycle).toBe(9)
  })
})

describe('autoflow command builders', () => {
  it('defaults remote writes off unless explicitly enabled', () => {
    expect(defaultConfig({}, []).allowRemoteWrites).toBe(false)
    expect(defaultConfig({ AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES: '1' }, []).allowRemoteWrites).toBe(true)
    expect(defaultConfig({ AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES: 'true' }, []).allowRemoteWrites).toBe(true)
    expect(defaultConfig({ AEDEV_AUTOFLOW_ROTATE_REMOTE_BRANCHES: '1' }, []).rotateRemoteBranches).toBe(true)
    expect(defaultConfig({ AEDEV_AUTOFLOW_SETUP_COMMANDS: 'npm install||npm test' }, []).setupCommands).toEqual(['npm install', 'npm test'])
    expect(defaultConfig({}, []).coderProvider).toBe('codex')
    expect(defaultConfig({ AEDEV_AUTOFLOW_CODER_PROVIDER: 'claude' }, []).coderProvider).toBe('claude')
    expect(defaultConfig({ AEDEV_AUTOFLOW_WORKTREE_FETCH_TIMEOUT_MS: '120000' }, []).worktreeFetchTimeoutMs).toBe(120000)
    expect(defaultConfig({ AEDEV_AUTOFLOW_RETAIN_CYCLE_WORKTREES: '4' }, []).retainedCycleWorktrees).toBe(4)
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

describe('spawn command runner', () => {
  it('kills lingering process groups after command timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-timeout-'))
    const pidFile = join(dir, 'child.pid')
    const runner = new SpawnCommandRunner({ timeoutKillGraceMs: 25 })
    let childPid: number | undefined

    try {
      const result = await runner.run('/bin/sh', ['-lc', [
        "trap 'exit 0' TERM",
        `(trap '' TERM; while true; do sleep 1; done) & echo $! > ${shellQuote(pidFile)}`,
        'wait',
      ].join('; ')], { cwd: dir, timeoutMs: 50 })

      childPid = Number(readFileSync(pidFile, 'utf8').trim())
      await delay(75)

      expect(result.exitCode).toBe(124)
      expect(isProcessAlive(childPid)).toBe(false)
    } finally {
      if (childPid !== undefined && isProcessAlive(childPid)) {
        try { process.kill(childPid, 'SIGKILL') } catch { /* already gone */ }
      }
    }
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

  it('logs prepare sub-stage events around worktree, workbook seed, and setup commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-prepare-events-'))
    const config = { ...testConfig(dir), setupCommands: ['npm install'] }
    mkdirSync(join(config.worktreePath, '.git'), { recursive: true })
    await runAutoflow(config, new FakeRunner({ changedPaths: ['src/example.ts'] }))
    const eventTypes = readFileSync(config.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string })
      .map((event) => event.type)
    expect(eventTypes).toContain('autoflow.ensure_worktree_started')
    expect(eventTypes).toContain('autoflow.ensure_worktree_completed')
    expect(eventTypes).toContain('autoflow.seed_workbook_started')
    expect(eventTypes).toContain('autoflow.seed_workbook_completed')
    expect(eventTypes).toContain('autoflow.setup_command_started')
    expect(eventTypes).toContain('autoflow.setup_command_completed')
  })

  it('prepares missing worktree branches without spawning git show-ref', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-local-branch-'))
    const config = { ...testConfig(dir), worktreePath: join(dir, 'new-worktree'), commandTimeoutMs: 60_000 }
    const runner = new WorktreeCreateRunner({ changedPaths: ['src/example.ts'] })

    const results = await runAutoflow(config, runner)
    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '))

    expect(results[0]?.status).toBe('completed')
    expect(commands.some((command) => command.includes('show-ref'))).toBe(false)
    expect(commands).toContain('git branch codex/autoflow-workbook HEAD')
    expect(commands).toContain(`git worktree add ${config.worktreePath} codex/autoflow-workbook`)
  })

  it('refreshes the remote base ref during worktree preparation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-local-remote-ref-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    mkdirSync(join(config.repoRoot, '.git', 'refs', 'remotes', 'origin'), { recursive: true })
    writeFileSync(join(config.repoRoot, '.git', 'refs', 'remotes', 'origin', 'main'), 'base-sha\n')
    const runner = new WorktreeCreateRunner({ changedPaths: [] })

    const results = await runAutoflow(config, runner)
    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '))

    expect(results[0]?.status).toBe('completed')
    expect(commands).toContain('git fetch origin main')
    expect(commands).toContain('git branch codex/autoflow-workbook origin/main')
    expect(commands).toContain(`git worktree add ${config.worktreePath} codex/autoflow-workbook`)
  })

  it('marks state running while worktree preparation is active', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-active-state-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    mkdirSync(join(config.repoRoot, '.git', 'refs', 'remotes', 'origin'), { recursive: true })
    writeFileSync(join(config.repoRoot, '.git', 'refs', 'remotes', 'origin', 'main'), 'base-sha\n')
    let observedState: ReturnType<typeof loadState> | undefined
    class InspectPrepareRunner extends WorktreeCreateRunner {
      override async run(command: string, args: string[], callOpts: { cwd: string; timeoutMs: number; stdin?: string }): Promise<CommandResult> {
        if ([command, ...args].join(' ').includes('fetch origin main')) {
          observedState = loadState(config)
        }
        return super.run(command, args, callOpts)
      }
    }

    const results = await runAutoflow(config, new InspectPrepareRunner({ changedPaths: ['src/example.ts'] }))

    expect(results[0]?.status).toBe('completed')
    expect(observedState?.status).toBe('running')
    expect(observedState?.currentCycle).toBe(1)
  })

  it('holds transiently when remote base fetch times out during worktree preparation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-fetch-timeout-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
      commandTimeoutMs: 1800_000,
    }
    const runner = new WorktreeCreateRunner({ fetchTimeouts: 1, changedPaths: ['src/example.ts'] })

    const results = await runAutoflow(config, runner)
    const state = loadState(config)

    expect(results[0]?.status).toBe('hold')
    expect(state.hold?.code).toBe('SETUP_FETCH_TIMEOUT')
    expect(state.hold?.resumeAfter).toBeTruthy()
    expect(state.hold?.retryCount).toBe(1)
    expect(state.hold?.operatorHint).toContain(`git -C ${config.repoRoot} fetch origin main`)
    expect(readFileSync(join(config.evidenceDir, 'cycle-000001', 'HOLD.md'), 'utf8')).toContain('Operator hint:')
    expect(state.consecutiveSetupFetchTimeouts).toBe(1)
    const events = readFileSync(config.logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; timeoutMs?: number; exitCode?: number; stderr?: string })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'autoflow.setup_fetch_started',
      timeoutMs: 60_000,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'autoflow.setup_fetch_completed',
      exitCode: 124,
      timeoutMs: 60_000,
      stderr: 'fetch timed out',
    }))
    expect(runner.calls.some((call) => call.command === 'claude')).toBe(false)
  })

  it('uses the configured worktree fetch timeout when preparing remote worktrees', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-fetch-timeout-config-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
      commandTimeoutMs: 1800_000,
      worktreeFetchTimeoutMs: 123_000,
    }
    const runner = new WorktreeCreateRunner({ changedPaths: ['src/example.ts'] })

    const results = await runAutoflow(config, runner)
    const events = readFileSync(config.logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; timeoutMs?: number; exitCode?: number })

    expect(results[0]?.status).toBe('completed')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'autoflow.setup_fetch_started',
      timeoutMs: 123_000,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'autoflow.setup_fetch_completed',
      exitCode: 0,
      timeoutMs: 123_000,
    }))
  })

  it('backs off repeated setup fetch timeout retries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-fetch-backoff-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    saveState(config, { ...loadState(config), consecutiveSetupFetchTimeouts: 1 })
    const runner = new WorktreeCreateRunner({ fetchTimeouts: 1, changedPaths: ['src/example.ts'] })
    const before = Date.now()

    const results = await runAutoflow(config, runner)
    const state = loadState(config)
    const resumeAfter = Date.parse(state.hold?.resumeAfter ?? '')

    expect(results[0]?.status).toBe('hold')
    expect(state.hold?.code).toBe('SETUP_FETCH_TIMEOUT')
    expect(state.hold?.retryCount).toBe(2)
    expect(state.consecutiveSetupFetchTimeouts).toBe(2)
    expect(resumeAfter).toBeGreaterThanOrEqual(before + 10 * 60_000)
  })

  it('signals repeated setup fetch timeouts after max backoff is reached', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-fetch-repeated-summary-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    saveState(config, { ...loadState(config), consecutiveSetupFetchTimeouts: 5 })
    const runner = new WorktreeCreateRunner({ fetchTimeouts: 1, changedPaths: ['src/example.ts'] })

    const results = await runAutoflow(config, runner)
    const summary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as {
      hold?: { retryCount?: number; operatorHint?: string }
      plannerSignals: string[]
    }

    expect(results[0]?.status).toBe('hold')
    expect(summary.hold?.retryCount).toBe(6)
    expect(summary.hold?.operatorHint).toContain('repeated setup fetch issue after 6 retries')
    expect(summary.plannerSignals).toContain('setup_fetch_repeated:6')
    expect(summary.plannerSignals).toContain('setup_fetch_max_backoff')
  })

  it('auto-resumes transient setup fetch cwd failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-fetch-transient-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    const runner = new WorktreeCreateRunner({
      fetchFailureStderr: 'fatal: Unable to read current working directory: Operation not permitted\n',
      changedPaths: ['src/example.ts'],
    })

    const results = await runAutoflow(config, runner)
    const state = loadState(config)

    expect(results[0]?.status).toBe('hold')
    expect(state.hold?.code).toBe('SETUP_FETCH_TRANSIENT')
    expect(state.hold?.resumeAfter).toBeTruthy()
    expect(state.hold?.retryCount).toBe(1)
    expect(state.consecutiveSetupFetchTimeouts).toBe(1)
    expect(runner.calls.some((call) => call.command === 'claude')).toBe(false)
  })

  it('auto-resumes an expired setup fetch timeout hold on the next tick', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-worktree-fetch-resume-'))
    const config = {
      ...testConfig(dir),
      worktreePath: join(dir, 'new-worktree'),
      allowRemoteWrites: true,
      remoteMode: 'pr' as const,
    }
    saveState(config, {
      ...loadState(config),
      status: 'hold',
      hold: {
        code: 'SETUP_FETCH_TIMEOUT',
        reason: 'git fetch timed out while preparing base origin/main',
        cycle: 1,
        createdAt: '2026-06-23T07:29:48.162Z',
        resumeAfter: '1970-01-01T00:00:00.000Z',
      },
    })
    const runner = new WorktreeCreateRunner({ changedPaths: ['src/example.ts'] })

    const results = await runAutoflow(config, runner)

    expect(results[0]?.status).toBe('completed')
    expect(loadState(config).status).toBe('idle')
    expect(loadState(config).hold).toBeUndefined()
    expect(loadState(config).consecutiveSetupFetchTimeouts).toBe(0)
    expect(runner.calls.map((call) => [call.command, ...call.args].join(' '))).toContain('git fetch origin main')
  })

  it('retries Codex up to the configured limit before committing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-cycle-'))
    const config = seededConfig(dir)
    const runner = new FakeRunner({ codexFailures: 2, changedPaths: ['src/example.ts'] })
    const result = await runOneCycle(config, runner, loadState(config))
    expect(result.status).toBe('completed')
    expect(runner.codexCalls).toBe(3)
  })

  it('skips gates for failed Codex attempts and runs gates after a successful retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-codex-fail-gates-'))
    const config = seededConfig(dir)
    const runner = new FakeRunner({ codexFailures: 1, changedPaths: ['src/example.ts'] })

    const result = await runOneCycle(config, runner, loadState(config))
    const events = readFileSync(config.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; attempt?: number })
    const gateAttempts = events
      .filter((event) => event.type === 'autoflow.gates_started')
      .map((event) => event.attempt)

    expect(result.status).toBe('completed')
    expect(gateAttempts).toEqual([2])
  })

  it('holds immediately on Codex usage limits without retrying or running gates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-codex-usage-limit-'))
    const config = seededConfig(dir)
    const runner = new FakeRunner({
      codexFailures: 3,
      changedPaths: ['src/example.ts'],
      codexFailureStdout: `{"type":"error","message":"You've hit your usage limit. Try again at Jun 23rd, 2026 12:01 AM."}\n`,
    })

    const result = await runOneCycle(config, runner, loadState(config))
    const events = readFileSync(config.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string })

    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('CODEX_USAGE_LIMIT')
    expect(result.hold?.resumeAfter).toBe(new Date(2026, 5, 23, 0, 1).toISOString())
    expect(runner.codexCalls).toBe(1)
    expect(events.some((event) => event.type === 'autoflow.gates_started')).toBe(false)
  })

  it('auto-resumes an expired Codex usage-limit hold on the next tick', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-codex-usage-resume-'))
    const config = testConfig(dir)
    mkdirSync(join(config.worktreePath, '.git'), { recursive: true })
    saveState(config, {
      ...loadState(config),
      status: 'hold',
      hold: {
        code: 'CODEX_USAGE_LIMIT',
        reason: 'Codex usage limit reached',
        cycle: 4,
        createdAt: '2026-06-22T23:50:00.000Z',
        resumeAfter: '1970-01-01T00:00:00.000Z',
      },
    })

    const results = await runAutoflow(config, new FakeRunner({ changedPaths: ['src/example.ts'] }))
    const eventTypes = readFileSync(config.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string })
      .map((event) => event.type)

    expect(results[0]?.status).toBe('completed')
    expect(loadState(config).status).toBe('idle')
    expect(loadState(config).hold).toBeUndefined()
    expect(eventTypes).toContain('autoflow.hold_auto_resumed')
  })

  it('stays on hold until a Codex usage-limit resume time arrives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-codex-usage-wait-'))
    const config = testConfig(dir)
    const runner = new FakeRunner({ changedPaths: ['src/example.ts'] })
    saveState(config, {
      ...loadState(config),
      status: 'hold',
      hold: {
        code: 'CODEX_USAGE_LIMIT',
        reason: 'Codex usage limit reached',
        cycle: 4,
        createdAt: '2026-06-22T23:50:00.000Z',
        resumeAfter: '2999-01-01T00:00:00.000Z',
      },
    })

    const results = await runAutoflow(config, runner)

    expect(results).toEqual([])
    expect(loadState(config).status).toBe('hold')
    expect(runner.calls).toHaveLength(0)
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

  it('can use Claude Code as the coder provider without invoking Codex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-claude-coder-'))
    const config = { ...seededConfig(dir), coderProvider: 'claude' as const }
    const runner = new FakeRunner({ changedPaths: ['src/example.ts'] })

    const result = await runOneCycle(config, runner, loadState(config))
    const events = readFileSync(config.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; provider?: string })

    expect(result.status).toBe('completed')
    expect(runner.claudeCalls).toBe(2)
    expect(runner.codexCalls).toBe(0)
    expect(events).toContainEqual(expect.objectContaining({ type: 'autoflow.coder_started', provider: 'claude' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'autoflow.coder_completed', provider: 'claude' }))
    expect(events.map((event) => event.type)).not.toContain('autoflow.codex_started')
  })

  it('writes provider-aware prompts and summary fields for Claude Code coder runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-claude-coder-evidence-'))
    const config = { ...seededConfig(dir), coderProvider: 'claude' as const }

    await runOneCycle(config, new FakeRunner({ changedPaths: ['src/example.ts'] }), loadState(config))

    const cycleDir = join(config.evidenceDir, 'cycle-000001')
    const plannerPrompt = readFileSync(join(cycleDir, 'claude-prompt.md'), 'utf8')
    const summary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as {
      coderProvider?: string
      stageDurationsMs: { coder?: number; codex?: number }
    }

    expect(plannerPrompt).toContain('guidance for Claude Code coder')
    expect(plannerPrompt).not.toContain('guidance for Codex')
    expect(plannerPrompt).not.toContain('ask Codex to edit')
    expect(summary.coderProvider).toBe('claude')
    expect(summary.stageDurationsMs.coder).toBeGreaterThanOrEqual(0)
    expect(summary.stageDurationsMs.codex).toBeUndefined()
  })

  it('emits heartbeats while long Claude planner and coder stages run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-stage-heartbeat-'))
    const config = {
      ...seededConfig(dir),
      coderProvider: 'claude' as const,
      stageHeartbeatIntervalMs: 5,
    }

    await runOneCycle(config, new FakeRunner({ changedPaths: ['src/example.ts'], claudeDelayMs: 20 }), loadState(config))

    const heartbeats = readFileSync(config.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; stage?: string; provider?: string })
      .filter((event) => event.type === 'autoflow.stage_heartbeat')

    expect(heartbeats).toContainEqual(expect.objectContaining({ stage: 'claude' }))
    expect(heartbeats).toContainEqual(expect.objectContaining({ stage: 'coder', provider: 'claude' }))
  })

  it('adopts an existing coder commit when the worktree is already clean', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-adopt-coder-commit-'))
    const config = { ...seededConfig(dir), coderProvider: 'claude' as const }
    const runner = new FakeRunner({
      committedChangedPaths: ['src/example.ts'],
      commitFailureStderr: 'nothing to commit, working tree clean\n',
      headSha: 'coder-commit-sha',
    })

    const result = await runOneCycle(config, runner, loadState(config))
    const summary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as {
      commitSha?: string
      changedPaths: string[]
      productivePaths: string[]
    }

    expect(result.status).toBe('completed')
    expect(result.commitSha).toBe('coder-commit-sha')
    expect(summary.commitSha).toBe('coder-commit-sha')
    expect(summary.changedPaths).toEqual(['src/example.ts'])
    expect(summary.productivePaths).toEqual(['src/example.ts'])
  })

  it('adopts an existing coder commit when only workbook changes remain unstaged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-adopt-coder-commit-workbook-'))
    const config = { ...seededConfig(dir), coderProvider: 'claude' as const }
    const runner = new FakeRunner({
      committedChangedPaths: ['src/example.ts'],
      unstagedChangedPathsAfterCoder: ['WORKBOOK_v4.md'],
      commitFailureStderr: 'Changes not staged for commit:\n\tmodified:   WORKBOOK_v4.md\n\nno changes added to commit\n',
      headSha: 'coder-commit-sha',
    })

    const result = await runOneCycle(config, runner, loadState(config))
    const summary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as {
      commitSha?: string
      changedPaths: string[]
      productivePaths: string[]
    }

    expect(result.status).toBe('completed')
    expect(result.commitSha).toBe('coder-commit-sha')
    expect(summary.commitSha).toBe('coder-commit-sha')
    expect(summary.changedPaths).toEqual(['WORKBOOK_v4.md', 'src/example.ts'])
    expect(summary.productivePaths).toEqual(['src/example.ts'])
  })

  it('writes a latest and per-cycle summary with repetition signals', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-summary-'))
    const config = seededConfig(dir)
    for (const cycle of [1, 2]) {
      const cycleDir = join(config.evidenceDir, `cycle-00000${cycle}`)
      mkdirSync(cycleDir, { recursive: true })
      writeFileSync(join(cycleDir, 'changed-paths.json'), JSON.stringify({
        productivePaths: ['src/lib/calculations.test.ts'],
      }) + '\n')
    }
    const state = { ...loadState(config), nextCycle: 3 }
    saveState(config, state)

    const result = await runOneCycle(config, new FakeRunner({ changedPaths: ['src/lib/calculations.test.ts'] }), state)
    const latestSummary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as {
      productivePaths: string[]
      repetition: { sameProductivePathStreak: number }
      plannerSignals: string[]
      gates: Array<{ command: string; exitCode: number }>
    }
    const cycleSummary = JSON.parse(readFileSync(join(config.evidenceDir, 'cycle-000003', 'autoflow-summary.json'), 'utf8')) as {
      cycle: number
    }

    expect(result.status).toBe('completed')
    expect(latestSummary.productivePaths).toEqual(['src/lib/calculations.test.ts'])
    expect(latestSummary.gates).toEqual([{ command: 'pnpm typecheck', exitCode: 0 }])
    expect(latestSummary.repetition.sameProductivePathStreak).toBe(3)
    expect(latestSummary.plannerSignals).toContain('repeated_productive_paths:3')
    expect(cycleSummary.cycle).toBe(3)
  })

  it('signals when recent cycles are test-heavy even with some source changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-test-heavy-summary-'))
    const config = seededConfig(dir)
    const priorPaths = [
      ['src/lib/calculations.test.ts'],
      ['src/lib/category.test.ts'],
      ['src/lib/calculations.test.ts'],
      ['src/lib/category.ts'],
      ['src/lib/category.test.ts'],
    ]
    priorPaths.forEach((productivePaths, index) => {
      const cycleDir = join(config.evidenceDir, `cycle-00000${index + 1}`)
      mkdirSync(cycleDir, { recursive: true })
      writeFileSync(join(cycleDir, 'changed-paths.json'), JSON.stringify({ productivePaths }) + '\n')
    })
    const state = { ...loadState(config), nextCycle: 6 }
    saveState(config, state)

    await runOneCycle(config, new FakeRunner({ changedPaths: ['src/lib/calculations.test.ts'] }), state)

    const latestSummary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as {
      plannerSignals: string[]
      repetition: { categoryCounts: Record<string, number> }
    }
    expect(latestSummary.repetition.categoryCounts).toEqual({ test: 5, source: 1 })
    expect(latestSummary.plannerSignals).toContain('test_heavy_window')
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

  it('passes latest planner signals into the Claude planning prompt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-prompt-summary-'))
    const config = seededConfig(dir)
    writeFileSync(config.summaryPath, JSON.stringify({ plannerSignals: ['repeated_productive_paths:3', 'test_only_window'] }) + '\n')
    const runner = new FakeRunner({ changedPaths: ['src/example.ts'] })

    await runOneCycle(config, runner, loadState(config))

    const claudeCall = runner.calls.find((call) => call.command === 'claude')
    expect(claudeCall?.stdin).toContain(`Latest autoflow summary: ${config.summaryPath}`)
    expect(claudeCall?.stdin).toContain('Latest planner signals: repeated_productive_paths:3, test_only_window')
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

  it('prunes old rotated worktrees after a successful cycle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflow-remote-prune-worktrees-'))
    const baseConfig = seededConfig(dir)
    for (const cycle of [1, 2, 3, 4, 5]) {
      mkdirSync(join(dir, `worktree-cycle-00000${cycle}`, '.git'), { recursive: true })
    }
    writeFileSync(join(dir, 'worktree-cycle-000005', 'WORKBOOK_v4.md'), readFileSync(baseConfig.workbookPath, 'utf8'))
    const config = {
      ...baseConfig,
      branch: 'codex/autoflow-workbook-cycle-000005',
      worktreePath: join(dir, 'worktree-cycle-000005'),
      allowRemoteWrites: true,
      remoteMode: 'pr-merge' as const,
      rotateRemoteBranches: true,
      retainedCycleWorktrees: 2,
    }
    const state = {
      ...loadState(baseConfig),
      nextCycle: 5,
      branch: config.branch,
      worktreePath: config.worktreePath,
      seeded: true,
    }
    saveState(baseConfig, state)

    const runner = new FakeRunner({ changedPaths: ['src/example.ts'] })
    const result = await runOneCycle(config, runner, state)
    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '))
    const events = readFileSync(config.logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; removed?: number; attempted?: number; path?: string })

    expect(result.status).toBe('completed')
    expect(commands).toContain(`git worktree remove --force ${join(dir, 'worktree-cycle-000001')}`)
    expect(commands).toContain(`git worktree remove --force ${join(dir, 'worktree-cycle-000002')}`)
    expect(commands).not.toContain(`git worktree remove --force ${join(dir, 'worktree-cycle-000005')}`)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'autoflow.cycle_worktree_prune_completed',
      removed: 2,
      attempted: 2,
    }))
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
    const summary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as { changedPaths: string[]; plannerSignals: string[] }
    expect(result.status).toBe('hold')
    expect(result.hold?.code).toBe('REMOTE_WRITE_POLICY_BLOCKED')
    expect(summary.changedPaths).toContain('package.json')
    expect(summary.plannerSignals).toContain('hold:REMOTE_WRITE_POLICY_BLOCKED')
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
    summaryPath: join(dir, 'autoflow-summary.json'),
    logPath: join(dir, 'logs', 'autoflow.jsonl'),
    evidenceDir: join(dir, 'evidence'),
    claudeBin: 'claude',
    codexBin: 'codex',
    pnpmBin: 'pnpm',
    ghBin: 'gh',
    claudeEffort: 'high',
    codexConfig: [],
    coderProvider: 'codex',
    setupCommands: [],
    gateCommands: ['pnpm typecheck'],
    forbiddenPatterns: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    maxCycles: 1,
    maxCoderRetries: 3,
    holdAfterConsecutiveFailures: 3,
    holdAfterConsecutiveEmptyDiffs: 3,
    commandTimeoutMs: 1000,
    worktreeFetchTimeoutMs: 60_000,
    retainedCycleWorktrees: 12,
    stageHeartbeatIntervalMs: 60_000,
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
