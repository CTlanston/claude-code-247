import { spawn } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export type AutoflowStatus = 'running' | 'hold'
export type RemoteWriteMode = 'off' | 'pr' | 'pr-merge'

export interface AutoflowConfig {
  repoRoot: string
  workbookPath: string
  homeDir: string
  worktreePath: string
  branch: string
  statePath: string
  summaryPath: string
  logPath: string
  evidenceDir: string
  claudeBin: string
  codexBin: string
  pnpmBin: string
  ghBin: string
  claudeModel?: string
  claudeEffort: string
  codexModel?: string
  codexConfig: string[]
  setupCommands: string[]
  gateCommands: string[]
  forbiddenPatterns: string[]
  maxCycles: number | null
  maxCodexRetries: number
  holdAfterConsecutiveFailures: number
  holdAfterConsecutiveEmptyDiffs: number
  commandTimeoutMs: number
  cycleSleepMs: number
  allowRemoteWrites: boolean
  remoteMode: RemoteWriteMode
  remoteName: string
  prBaseBranch: string
  rotateRemoteBranches: boolean
}

export interface AutoflowState {
  version: 1
  status: AutoflowStatus
  nextCycle: number
  branch: string
  worktreePath: string
  seeded: boolean
  consecutiveFailures: number
  consecutiveEmptyDiffs: number
  consecutiveNoProductiveChanges: number
  currentCycle?: number
  lastCommitSha?: string
  lastStartedAt?: string
  lastCompletedAt?: string
  hold?: HoldRecord
}

export interface HoldRecord {
  code: string
  reason: string
  cycle: number
  createdAt: string
}

export interface CommandResult {
  command: string
  args: string[]
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface GateResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

export interface RemoteWritePlan {
  allowed: boolean
  mode: RemoteWriteMode
  reason: string
}

export interface CycleResult {
  cycle: number
  status: 'completed' | 'hold'
  evidenceDir: string
  commitSha?: string
  hold?: HoldRecord
}

export interface AutoflowSummary {
  version: 1
  updatedAt: string
  status: 'completed' | 'hold'
  cycle: number
  nextCycle: number
  branch: string
  worktreePath: string
  evidenceDir: string
  commitSha?: string
  hold?: HoldRecord
  changedPaths: string[]
  productivePaths: string[]
  gates: Array<{ command: string; exitCode: number }>
  stageDurationsMs: {
    claude?: number
    codex?: number
    remoteWrite?: number
  }
  repetition: {
    windowSize: number
    sameProductivePathStreak: number
    repeatedProductivePaths: string[]
    categoryCounts: Record<string, number>
  }
  plannerSignals: string[]
}

export interface CommandRunner {
  run(command: string, args: string[], opts: { cwd: string; timeoutMs: number; stdin?: string }): Promise<CommandResult>
}

const DEFAULT_REPO_ROOT = '/Users/lanston/projects/claude-code-247'
const DEFAULT_BRANCH = 'codex/autoflow-workbook'
const DEFAULT_HOME = join(homedir(), '.claude-code-247', 'autoflow')
const DEFAULT_GATES = ['pnpm typecheck', 'pnpm lint', 'pnpm test']
const DEFAULT_FORBIDDEN = ['.env*', 'secrets/**', '.github/**', 'AGENTS.md']
const WORKTREE_FETCH_TIMEOUT_MS = 60_000
const DEFAULT_TIMEOUT_KILL_GRACE_MS = 2_000

export function defaultConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv.slice(2)): AutoflowConfig {
  const repoRoot = resolve(env['AEDEV_AUTOFLOW_REPO_ROOT'] ?? DEFAULT_REPO_ROOT)
  const homeDir = resolve(env['AEDEV_AUTOFLOW_HOME'] ?? DEFAULT_HOME)
  const worktreePath = resolve(env['AEDEV_AUTOFLOW_WORKTREE'] ?? join(homeDir, 'worktrees', 'claude-code-247'))
  const evidenceDir = resolve(env['AEDEV_AUTOFLOW_EVIDENCE_DIR'] ?? join(homeDir, 'evidence'))
  const maxCyclesArg = argValue(argv, '--max-cycles')
  const maxCyclesEnv = env['AEDEV_AUTOFLOW_MAX_CYCLES']
  const maxCyclesRaw = maxCyclesArg ?? maxCyclesEnv
  return {
    repoRoot,
    workbookPath: resolve(env['AEDEV_AUTOFLOW_WORKBOOK'] ?? join(repoRoot, 'WORKBOOK_v4.md')),
    homeDir,
    worktreePath,
    branch: env['AEDEV_AUTOFLOW_BRANCH'] ?? DEFAULT_BRANCH,
    statePath: resolve(env['AEDEV_AUTOFLOW_STATE'] ?? join(homeDir, 'state.json')),
    summaryPath: resolve(env['AEDEV_AUTOFLOW_SUMMARY'] ?? join(homeDir, 'autoflow-summary.json')),
    logPath: resolve(env['AEDEV_AUTOFLOW_LOG'] ?? join(homeDir, 'logs', 'autoflow.jsonl')),
    evidenceDir,
    claudeBin: env['AEDEV_CLAUDE_BIN'] ?? 'claude',
    codexBin: env['AEDEV_CODEX_BIN'] ?? 'codex',
    pnpmBin: env['AEDEV_PNPM_BIN'] ?? 'pnpm',
    ghBin: env['AEDEV_GH_BIN'] ?? 'gh',
    claudeModel: emptyToUndefined(env['AEDEV_AUTOFLOW_CLAUDE_MODEL']),
    claudeEffort: env['AEDEV_AUTOFLOW_CLAUDE_EFFORT'] ?? 'high',
    codexModel: emptyToUndefined(env['AEDEV_AUTOFLOW_CODEX_MODEL']),
    codexConfig: parseList(env['AEDEV_AUTOFLOW_CODEX_CONFIG']),
    setupCommands: parseList(env['AEDEV_AUTOFLOW_SETUP_COMMANDS']),
    gateCommands: parseList(env['AEDEV_AUTOFLOW_GATES'], DEFAULT_GATES),
    forbiddenPatterns: parseList(env['AEDEV_AUTOFLOW_FORBIDDEN'], DEFAULT_FORBIDDEN),
    maxCycles: parseMaxCycles(maxCyclesRaw),
    maxCodexRetries: Number(env['AEDEV_AUTOFLOW_CODEX_RETRIES'] ?? '3'),
    holdAfterConsecutiveFailures: Number(env['AEDEV_AUTOFLOW_HOLD_AFTER_FAILURES'] ?? '3'),
    holdAfterConsecutiveEmptyDiffs: Number(env['AEDEV_AUTOFLOW_HOLD_AFTER_EMPTY_DIFFS'] ?? '3'),
    commandTimeoutMs: Number(env['AEDEV_AUTOFLOW_COMMAND_TIMEOUT_MS'] ?? '1800000'),
    cycleSleepMs: Number(env['AEDEV_AUTOFLOW_CYCLE_SLEEP_MS'] ?? '0'),
    allowRemoteWrites: parseBoolean(env['AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES']),
    remoteMode: parseRemoteWriteMode(env['AEDEV_AUTOFLOW_REMOTE_MODE']),
    remoteName: env['AEDEV_AUTOFLOW_REMOTE_NAME'] ?? 'origin',
    prBaseBranch: env['AEDEV_AUTOFLOW_PR_BASE'] ?? 'main',
    rotateRemoteBranches: parseBoolean(env['AEDEV_AUTOFLOW_ROTATE_REMOTE_BRANCHES']),
  }
}

export async function runAutoflowCli(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv.slice(2)): Promise<void> {
  const config = defaultConfig(env, argv)
  logEvent(config, {
    type: 'autoflow.cli_started',
    argv,
    statePath: config.statePath,
    worktreePath: config.worktreePath,
    branch: config.branch,
    remoteMode: config.remoteMode,
  })
  const runner = new SpawnCommandRunner({ allowRemoteWrites: config.allowRemoteWrites })
  await runAutoflow(config, runner)
  logEvent(config, { type: 'autoflow.cli_completed' })
}

export async function runAutoflow(config: AutoflowConfig, runner: CommandRunner = new SpawnCommandRunner()): Promise<CycleResult[]> {
  ensureDir(dirname(config.statePath))
  ensureDir(dirname(config.logPath))
  ensureDir(config.evidenceDir)

  const state = loadState(config)
  if (state.status === 'hold') {
    logEvent(config, { type: 'autoflow.already_on_hold', hold: state.hold ?? null })
    return []
  }

  try {
    logEvent(config, { type: 'autoflow.setup_assert_started' })
    await assertCliAvailable(config, runner)
    logEvent(config, { type: 'autoflow.setup_assert_completed' })
  } catch (error) {
    const setupState = loadState(config)
    const cycle = setupState.nextCycle
    const cycleDir = join(config.evidenceDir, cycleIdFor(cycle))
    ensureDir(cycleDir)
    const result = await hold(config, cycle, 'SETUP_FAILED', (error as Error).message, cycleDir, setupState)
    return [result]
  }

  const results: CycleResult[] = []
  let completedThisRun = 0
  while (config.maxCycles === null || completedThisRun < config.maxCycles) {
    const fresh = loadState(config)
    if (fresh.status === 'hold') break
    const activeConfig = configForState(config, fresh)
    try {
      logEvent(config, {
        type: 'autoflow.prepare_worktree_started',
        cycle: fresh.nextCycle,
        branch: activeConfig.branch,
        worktreePath: activeConfig.worktreePath,
      })
      await prepareWorktree(activeConfig, runner, fresh, config)
      logEvent(config, {
        type: 'autoflow.prepare_worktree_completed',
        cycle: fresh.nextCycle,
        branch: activeConfig.branch,
        worktreePath: activeConfig.worktreePath,
      })
    } catch (error) {
      const cycle = fresh.nextCycle
      const cycleDir = join(config.evidenceDir, cycleIdFor(cycle))
      ensureDir(cycleDir)
      const result = await hold(config, cycle, 'SETUP_FAILED', (error as Error).message, cycleDir, fresh)
      results.push(result)
      break
    }
    const result = await runOneCycle(activeConfig, runner, fresh)
    results.push(result)
    if (result.status === 'hold') break
    completedThisRun++
    if (config.cycleSleepMs > 0) await sleep(config.cycleSleepMs)
  }
  return results
}

export async function runOneCycle(config: AutoflowConfig, runner: CommandRunner, state: AutoflowState): Promise<CycleResult> {
  const cycle = state.nextCycle
  const cycleId = cycleIdFor(cycle)
  const cycleDir = join(config.evidenceDir, cycleId)
  ensureDir(cycleDir)
  const startedAt = new Date().toISOString()
  const baseSha = (await git(config, runner, ['rev-parse', 'HEAD'])).stdout.trim()
  const workingBefore = await listChangedPaths(config, runner, baseSha)
  saveState(config, { ...state, status: 'running', currentCycle: cycle, lastStartedAt: startedAt })
  logEvent(config, { type: 'autoflow.cycle_started', cycle, cycleDir, baseSha })

  try {
    const claudePrompt = buildClaudePrompt(config, state, cycleDir)
    writeFileSync(join(cycleDir, 'claude-prompt.md'), claudePrompt)
    logEvent(config, { type: 'autoflow.claude_started', cycle, cycleDir })
    const claude = await runClaude(config, runner, claudePrompt)
    logEvent(config, { type: 'autoflow.claude_completed', cycle, exitCode: claude.exitCode, durationMs: claude.durationMs })
    writeCommandEvidence(cycleDir, 'claude-result.json', claude)
    writeFileSync(join(cycleDir, 'claude-output.txt'), claude.stdout || claude.stderr || '')
    if (claude.exitCode !== 0) {
      return await hold(config, cycle, 'CLAUDE_FAILED', `Claude exited ${claude.exitCode}`, cycleDir, state)
    }

    const claudeChanged = await listChangedPaths(config, runner, baseSha)
    const badClaudePaths = claudeChanged.filter((path) => !isWorkbookOrAutoflowArtifact(path))
    if (badClaudePaths.length > 0) {
      return await hold(config, cycle, 'CLAUDE_SCOPE_VIOLATION', `Claude touched non-workbook paths: ${badClaudePaths.join(', ')}`, cycleDir, state)
    }
    persistWorkbookSeed(config, cycleDir)

    let codex: CommandResult | undefined
    let gates: GateResult[] = []
    let retryContext = ''
    for (let attempt = 1; attempt <= config.maxCodexRetries; attempt++) {
      const codexPrompt = buildCodexPrompt(config, cycle, attempt, cycleDir, claude.stdout || claude.stderr, retryContext)
      writeFileSync(join(cycleDir, `codex-prompt-${attempt}.md`), codexPrompt)
      logEvent(config, { type: 'autoflow.codex_started', cycle, attempt })
      codex = await runCodex(config, runner, codexPrompt)
      logEvent(config, { type: 'autoflow.codex_completed', cycle, attempt, exitCode: codex.exitCode, durationMs: codex.durationMs })
      writeCommandEvidence(cycleDir, `codex-result-${attempt}.json`, codex)
      writeFileSync(join(cycleDir, `codex-output-${attempt}.txt`), codex.stdout || codex.stderr || '')
      if (codex.exitCode !== 0) {
        if (isCodexUsageLimit(codex)) {
          return await hold(config, cycle, 'CODEX_USAGE_LIMIT', codex.stdout || codex.stderr || 'Codex usage limit reached', cycleDir, state, {
            stageDurationsMs: { claude: claude.durationMs, codex: codex.durationMs },
          })
        }
        retryContext = renderRetryContext(codex, [])
        continue
      }
      logEvent(config, { type: 'autoflow.gates_started', cycle, attempt, commands: config.gateCommands })
      gates = await runGates(config, runner, cycleDir, attempt)
      logEvent(config, {
        type: 'autoflow.gates_completed',
        cycle,
        attempt,
        results: gates.map((gate) => ({ command: gate.command, exitCode: gate.exitCode })),
      })
      if (codex.exitCode === 0 && gates.every((gate) => gate.exitCode === 0)) break
      retryContext = renderRetryContext(codex, gates)
    }

    if (!codex || codex.exitCode !== 0) {
      return await recordFailureOrHold(config, cycle, 'CODEX_FAILED', `Codex exited ${codex?.exitCode ?? 'unknown'}`, cycleDir, state)
    }
    const failingGate = gates.find((gate) => gate.exitCode !== 0)
    if (failingGate) {
      return await recordFailureOrHold(config, cycle, 'GATES_FAILED', `Gate failed: ${failingGate.command}`, cycleDir, state)
    }

    const changedPaths = await listChangedPaths(config, runner, baseSha)
    const productivePaths = changedPaths.filter((path) => !isWorkbookOrAutoflowArtifact(path))
    writeFileSync(join(cycleDir, 'changed-paths.json'), JSON.stringify({ baseSha, changedPaths, productivePaths, workingBefore }, null, 2) + '\n')
    const forbiddenHits = changedPaths.filter((path) => config.forbiddenPatterns.some((pattern) => pathMatches(pattern, path)))
    if (forbiddenHits.length > 0) {
      return await hold(config, cycle, 'FORBIDDEN_PATH_TOUCHED', `Forbidden path touched: ${forbiddenHits.join(', ')}`, cycleDir, state, {
        changedPaths,
        productivePaths,
        gates,
        stageDurationsMs: { claude: claude.durationMs, codex: codex.durationMs },
      })
    }
    if (changedPaths.length === 0) {
      const emptyState = {
        ...state,
        consecutiveEmptyDiffs: state.consecutiveEmptyDiffs + 1,
        consecutiveNoProductiveChanges: state.consecutiveNoProductiveChanges + 1,
        consecutiveFailures: 0,
      }
      if (emptyState.consecutiveEmptyDiffs >= config.holdAfterConsecutiveEmptyDiffs) {
        return await hold(config, cycle, 'EMPTY_DIFF_STREAK', `No changed paths for ${emptyState.consecutiveEmptyDiffs} consecutive cycle(s)`, cycleDir, emptyState)
      }
      const completedEmpty = { ...emptyState, nextCycle: cycle + 1, currentCycle: undefined, lastCompletedAt: new Date().toISOString() }
      saveState(config, completedEmpty)
      writeAutoflowSummary(config, {
        status: 'completed',
        cycle,
        state: completedEmpty,
        cycleDir,
        changedPaths,
        productivePaths,
        gates,
        stageDurationsMs: { claude: claude.durationMs, codex: codex.durationMs },
      })
      logEvent(config, { type: 'autoflow.cycle_empty_diff', cycle, streak: emptyState.consecutiveEmptyDiffs })
      return { cycle, status: 'completed', evidenceDir: cycleDir }
    }
    if (productivePaths.length === 0) {
      const noProductiveState = {
        ...state,
        consecutiveFailures: 0,
        consecutiveEmptyDiffs: 0,
        consecutiveNoProductiveChanges: state.consecutiveNoProductiveChanges + 1,
      }
      if (noProductiveState.consecutiveNoProductiveChanges >= config.holdAfterConsecutiveEmptyDiffs) {
        return await hold(
          config,
          cycle,
          'NO_PRODUCTIVE_CHANGE',
          `No productive paths for ${noProductiveState.consecutiveNoProductiveChanges} consecutive cycle(s)`,
          cycleDir,
          noProductiveState,
        )
      }
      const completedNoProductive = { ...noProductiveState, nextCycle: cycle + 1, currentCycle: undefined, lastCompletedAt: new Date().toISOString() }
      saveState(config, completedNoProductive)
      writeAutoflowSummary(config, {
        status: 'completed',
        cycle,
        state: completedNoProductive,
        cycleDir,
        changedPaths,
        productivePaths,
        gates,
        stageDurationsMs: { claude: claude.durationMs, codex: codex.durationMs },
      })
      logEvent(config, {
        type: 'autoflow.cycle_no_productive_change',
        cycle,
        streak: noProductiveState.consecutiveNoProductiveChanges,
        changedPaths,
      })
      return { cycle, status: 'completed', evidenceDir: cycleDir }
    }

    const remoteCandidatePaths = await listRemoteWriteCandidatePaths(config, runner, changedPaths)
    if (config.remoteMode !== 'off') {
      writeFileSync(join(cycleDir, 'remote-write-candidate-paths.json'), JSON.stringify({
        changedPaths,
        remoteCandidatePaths,
        base: `${config.remoteName}/${config.prBaseBranch}`,
      }, null, 2) + '\n')
    }
    const remotePlan = planRemoteWriteStage(config, remoteCandidatePaths, gates)
    if (!remotePlan.allowed && remotePlan.mode !== 'off') {
      return await hold(config, cycle, 'REMOTE_WRITE_POLICY_BLOCKED', remotePlan.reason, cycleDir, state, {
        changedPaths,
        productivePaths,
        gates,
        stageDurationsMs: { claude: claude.durationMs, codex: codex.durationMs },
      })
    }

    const pathsToCommit = remotePlan.allowed ? productivePaths : changedPaths
    const commitSha = await commitCycle(config, runner, cycle, pathsToCommit)
    let remoteWriteDurationMs: number | undefined
    if (remotePlan.allowed) {
      logEvent(config, { type: 'autoflow.remote_write_started', cycle, mode: remotePlan.mode, commitSha })
      const remoteWrite = await runRemoteWriteStage(config, runner, cycle, cycleDir, commitSha)
      remoteWriteDurationMs = remoteWrite.durationMs
      logEvent(config, { type: 'autoflow.remote_write_completed', cycle, exitCode: remoteWrite.exitCode, durationMs: remoteWrite.durationMs })
      if (remoteWrite.exitCode !== 0) {
        return await hold(config, cycle, 'REMOTE_WRITE_FAILED', remoteWrite.stderr || remoteWrite.stdout || `Remote write failed: ${remoteWrite.command}`, cycleDir, state, {
          changedPaths,
          productivePaths,
          gates,
          stageDurationsMs: { claude: claude.durationMs, codex: codex.durationMs, remoteWrite: remoteWrite.durationMs },
        })
      }
    }

    const nextCycle = cycle + 1
    const nextLocation = remotePlan.allowed && config.remoteMode === 'pr-merge' && config.rotateRemoteBranches
      ? rotatedRemoteCycleLocation(config, nextCycle)
      : { branch: state.branch, worktreePath: state.worktreePath }
    const completed = {
      ...state,
      nextCycle,
      currentCycle: undefined,
      consecutiveFailures: 0,
      consecutiveEmptyDiffs: 0,
      consecutiveNoProductiveChanges: 0,
      branch: nextLocation.branch,
      worktreePath: nextLocation.worktreePath,
      lastCommitSha: commitSha,
      lastStartedAt: startedAt,
      lastCompletedAt: new Date().toISOString(),
    } satisfies AutoflowState
    writeFileSync(join(cycleDir, 'commit-sha.txt'), commitSha + '\n')
    saveState(config, completed)
    writeAutoflowSummary(config, {
      status: 'completed',
      cycle,
      state: completed,
      cycleDir,
      commitSha,
      changedPaths,
      productivePaths,
      gates,
      stageDurationsMs: { claude: claude.durationMs, codex: codex.durationMs, remoteWrite: remoteWriteDurationMs },
    })
    logEvent(config, { type: 'autoflow.cycle_completed', cycle, commitSha, changedPaths })
    return { cycle, status: 'completed', evidenceDir: cycleDir, commitSha }
  } catch (error) {
    return await recordFailureOrHold(config, cycle, 'CYCLE_ERROR', (error as Error).message, cycleDir, state)
  }
}

export function loadState(config: Pick<AutoflowConfig, 'statePath' | 'branch' | 'worktreePath'>): AutoflowState {
  if (!existsSync(config.statePath)) {
    return {
      version: 1,
      status: 'running',
      nextCycle: 1,
      branch: config.branch,
      worktreePath: config.worktreePath,
      seeded: false,
      consecutiveFailures: 0,
      consecutiveEmptyDiffs: 0,
      consecutiveNoProductiveChanges: 0,
    }
  }
  const parsed = JSON.parse(readFileSync(config.statePath, 'utf8')) as AutoflowState
  return {
    ...parsed,
    branch: parsed.branch || config.branch,
    worktreePath: parsed.worktreePath || config.worktreePath,
    consecutiveNoProductiveChanges: parsed.consecutiveNoProductiveChanges ?? 0,
  }
}

export function saveState(config: Pick<AutoflowConfig, 'statePath'>, state: AutoflowState): void {
  ensureDir(dirname(config.statePath))
  const tmp = `${config.statePath}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
  renameSync(tmp, config.statePath)
}

function configForState(config: AutoflowConfig, state: Pick<AutoflowState, 'branch' | 'worktreePath'>): AutoflowConfig {
  return { ...config, branch: state.branch, worktreePath: state.worktreePath }
}

export function buildClaudeArgs(config: Pick<AutoflowConfig, 'claudeModel' | 'claudeEffort'>): string[] {
  const args = [
    '--print',
    '--output-format',
    'json',
    '--permission-mode',
    'bypassPermissions',
    '--effort',
    config.claudeEffort,
  ]
  if (config.claudeModel) args.push('--model', config.claudeModel)
  return args
}

export function buildCodexArgs(config: Pick<AutoflowConfig, 'codexModel' | 'codexConfig'>): string[] {
  const args = [
    'exec',
    '--cd',
    '.',
    '--sandbox',
    'workspace-write',
    '-c',
    'approval_policy="never"',
    '--json',
    '--skip-git-repo-check',
  ]
  for (const item of config.codexConfig) args.push('-c', item)
  if (config.codexModel) args.push('--model', config.codexModel)
  args.push('-')
  return args
}

export function commandContainsRemoteWrite(command: string, args: string[]): boolean {
  const joined = [command, ...args].join(' ')
  return /\b(git\s+push|gh\s+pr\s+create|gh\s+pr\s+merge|git\s+merge|git\s+pull)\b/.test(joined)
}

export function shouldBlockRemoteWrite(command: string, args: string[], allowRemoteWrites: boolean): boolean {
  return commandContainsRemoteWrite(command, args) && !allowRemoteWrites
}

export function planRemoteWriteStage(
  config: Pick<AutoflowConfig, 'allowRemoteWrites' | 'remoteMode' | 'forbiddenPatterns'>,
  changedPaths: string[],
  gates: GateResult[],
): RemoteWritePlan {
  if (config.remoteMode === 'off') {
    return { allowed: false, mode: config.remoteMode, reason: 'remote stage disabled' }
  }
  if (!config.allowRemoteWrites) {
    return { allowed: false, mode: config.remoteMode, reason: 'remote writes disabled' }
  }
  const failingGate = gates.find((gate) => gate.exitCode !== 0)
  if (failingGate) {
    return { allowed: false, mode: config.remoteMode, reason: `gate failed: ${failingGate.command}` }
  }
  const forbiddenHits = changedPaths.filter((path) => config.forbiddenPatterns.some((pattern) => pathMatches(pattern, path)))
  if (forbiddenHits.length > 0) {
    return { allowed: false, mode: config.remoteMode, reason: `forbidden path touched: ${forbiddenHits.join(', ')}` }
  }
  const riskyPath = changedPaths.find(isMediumOrHighRiskRemoteWritePath)
  if (riskyPath) {
    return { allowed: false, mode: config.remoteMode, reason: `medium/high-risk path requires approval: ${riskyPath}` }
  }
  return { allowed: true, mode: config.remoteMode, reason: 'low-risk green change' }
}

export function pathMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3)
    return path === base || path.startsWith(`${base}/`)
  }
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1))
  return path === pattern
}

export class SpawnCommandRunner implements CommandRunner {
  constructor(private readonly opts: { allowRemoteWrites?: boolean; timeoutKillGraceMs?: number } = {}) {}

  run(command: string, args: string[], opts: { cwd: string; timeoutMs: number; stdin?: string }): Promise<CommandResult> {
    if (shouldBlockRemoteWrite(command, args, this.opts.allowRemoteWrites ?? false)) {
      throw new Error(`remote write command blocked: ${command} ${args.join(' ')}`)
    }
    const started = Date.now()
    return new Promise((resolveCommand) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: scrubRemoteWriteEnv(process.env, this.opts.allowRemoteWrites ?? false),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const killProcessGroup = (signal: NodeJS.Signals): void => {
        if (child.pid !== undefined) {
          try { process.kill(-child.pid, signal) } catch { /* already gone */ }
        }
      }
      const timer = setTimeout(() => {
        timedOut = true
        killProcessGroup('SIGTERM')
        killTimer = setTimeout(() => {
          killProcessGroup('SIGKILL')
          settle(124)
        }, this.opts.timeoutKillGraceMs ?? DEFAULT_TIMEOUT_KILL_GRACE_MS)
      }, opts.timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.stdin?.on('error', () => {})
      if (opts.stdin) child.stdin?.write(opts.stdin)
      child.stdin?.end()

      const settle = (exitCode: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        resolveCommand({
          command,
          args,
          cwd: opts.cwd,
          exitCode: timedOut ? 124 : exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        })
      }
      child.on('error', (error) => {
        stderr += error.message
        settle(1)
      })
      child.on('close', (code) => {
        if (timedOut) killProcessGroup('SIGKILL')
        settle(code ?? 1)
      })
    })
  }
}

async function assertCliAvailable(config: AutoflowConfig, runner: CommandRunner): Promise<void> {
  const bins = config.remoteMode === 'off'
    ? [config.claudeBin, config.codexBin, config.pnpmBin, 'git']
    : [config.claudeBin, config.codexBin, config.pnpmBin, config.ghBin, 'git']
  for (const bin of bins) {
    const result = await runner.run('/usr/bin/which', [bin], { cwd: config.repoRoot, timeoutMs: 5000 })
    if (result.exitCode !== 0) throw new Error(`required CLI not found: ${bin}`)
  }
}

async function ensureWorktree(config: AutoflowConfig, runner: CommandRunner): Promise<void> {
  ensureDir(dirname(config.worktreePath))
  if (existsSync(join(config.worktreePath, '.git'))) {
    await gitIn(config.worktreePath, runner, ['switch', config.branch], config.commandTimeoutMs)
    return
  }
  if (existsSync(config.worktreePath)) {
    throw new Error(`worktree path exists but is not a git worktree: ${config.worktreePath}`)
  }
  if (!localGitRefExists(config.repoRoot, `refs/heads/${config.branch}`)) {
    if (config.remoteMode !== 'off') {
      const fetch = await runner.run('git', ['fetch', config.remoteName, config.prBaseBranch], {
        cwd: config.repoRoot,
        timeoutMs: worktreeFetchTimeoutMs(config),
      })
      if (fetch.exitCode === 124) {
        throw new Error(`git fetch timed out while preparing base ${config.remoteName}/${config.prBaseBranch}`)
      }
      if (fetch.exitCode !== 0) {
        throw new Error(`git fetch failed while preparing base ${config.remoteName}/${config.prBaseBranch}: ${fetch.stderr || fetch.stdout || `exit ${fetch.exitCode}`}`)
      }
      await runner.run('git', ['branch', config.branch, `${config.remoteName}/${config.prBaseBranch}`], { cwd: config.repoRoot, timeoutMs: config.commandTimeoutMs })
    } else {
      await runner.run('git', ['branch', config.branch, 'HEAD'], { cwd: config.repoRoot, timeoutMs: config.commandTimeoutMs })
    }
  }
  const added = await runner.run('git', ['worktree', 'add', config.worktreePath, config.branch], {
    cwd: config.repoRoot,
    timeoutMs: config.commandTimeoutMs,
  })
  if (added.exitCode !== 0) throw new Error(`git worktree add failed: ${added.stderr || added.stdout}`)
}

async function prepareWorktree(
  activeConfig: AutoflowConfig,
  runner: CommandRunner,
  state: AutoflowState,
  stateConfig: Pick<AutoflowConfig, 'statePath' | 'logPath'>,
): Promise<void> {
  const cycle = state.nextCycle
  const ensureStarted = Date.now()
  logEvent(stateConfig, {
    type: 'autoflow.ensure_worktree_started',
    cycle,
    branch: activeConfig.branch,
    worktreePath: activeConfig.worktreePath,
  })
  await ensureWorktree(activeConfig, runner)
  logEvent(stateConfig, {
    type: 'autoflow.ensure_worktree_completed',
    cycle,
    durationMs: Date.now() - ensureStarted,
  })
  const workbookTarget = join(activeConfig.worktreePath, 'WORKBOOK_v4.md')
  if (!state.seeded || !existsSync(workbookTarget)) {
    logEvent(stateConfig, { type: 'autoflow.seed_workbook_started', cycle, target: workbookTarget })
    seedWorkbook(activeConfig)
    saveState(stateConfig, { ...state, seeded: true })
    logEvent(stateConfig, { type: 'autoflow.seed_workbook_completed', cycle, target: workbookTarget })
  }
  for (const [index, command] of activeConfig.setupCommands.entries()) {
    logEvent(stateConfig, { type: 'autoflow.setup_command_started', cycle, index, command })
    const result = await runner.run('/bin/sh', ['-lc', command], {
      cwd: activeConfig.worktreePath,
      timeoutMs: activeConfig.commandTimeoutMs,
    })
    logEvent(stateConfig, {
      type: 'autoflow.setup_command_completed',
      cycle,
      index,
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    })
    if (result.exitCode !== 0) throw new Error(`setup command failed: ${command}: ${result.stderr || result.stdout}`)
  }
}

function seedWorkbook(config: AutoflowConfig): void {
  const source = readFileSync(config.workbookPath, 'utf8')
  const target = join(config.worktreePath, 'WORKBOOK_v4.md')
  writeFileSync(target, source)
}

function persistWorkbookSeed(config: AutoflowConfig, cycleDir: string): void {
  const source = join(config.worktreePath, 'WORKBOOK_v4.md')
  if (!existsSync(source)) return
  const before = existsSync(config.workbookPath) ? readFileSync(config.workbookPath, 'utf8') : ''
  const after = readFileSync(source, 'utf8')
  const changed = before !== after
  if (changed) copyFileSync(source, config.workbookPath)
  writeFileSync(join(cycleDir, 'workbook-sync.json'), JSON.stringify({
    source,
    target: config.workbookPath,
    changed,
  }, null, 2) + '\n')
}

async function runClaude(config: AutoflowConfig, runner: CommandRunner, prompt: string): Promise<CommandResult> {
  return runner.run(config.claudeBin, buildClaudeArgs(config), {
    cwd: config.worktreePath,
    timeoutMs: config.commandTimeoutMs,
    stdin: prompt,
  })
}

async function runCodex(config: AutoflowConfig, runner: CommandRunner, prompt: string): Promise<CommandResult> {
  return runner.run(config.codexBin, buildCodexArgs(config), {
    cwd: config.worktreePath,
    timeoutMs: config.commandTimeoutMs,
    stdin: prompt,
  })
}

async function runGates(config: AutoflowConfig, runner: CommandRunner, cycleDir: string, attempt: number): Promise<GateResult[]> {
  const results: GateResult[] = []
  for (const command of config.gateCommands) {
    const result = await runner.run('/bin/sh', ['-lc', command], {
      cwd: config.worktreePath,
      timeoutMs: config.commandTimeoutMs,
    })
    results.push({ command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr })
  }
  writeFileSync(join(cycleDir, `gate-results-${attempt}.json`), JSON.stringify(results, null, 2) + '\n')
  return results
}

async function listChangedPaths(config: AutoflowConfig, runner: CommandRunner, baseSha: string): Promise<string[]> {
  const committed = await git(config, runner, ['diff', '--name-only', `${baseSha}..HEAD`])
  const status = await git(config, runner, ['status', '--porcelain=v1'])
  const paths = [
    ...committed.stdout.split('\n').filter(Boolean),
    ...status.stdout.split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, '')),
  ]
  return [...new Set(paths)].sort()
}

async function listRemoteWriteCandidatePaths(config: AutoflowConfig, runner: CommandRunner, changedPaths: string[]): Promise<string[]> {
  if (config.remoteMode === 'off') return changedPaths
  const baseRef = `${config.remoteName}/${config.prBaseBranch}`
  await runner.run('git', ['fetch', config.remoteName, config.prBaseBranch], {
    cwd: config.worktreePath,
    timeoutMs: config.commandTimeoutMs,
  })
  const remoteDiff = await runner.run('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    cwd: config.worktreePath,
    timeoutMs: config.commandTimeoutMs,
  })
  const remotePaths = remoteDiff.stdout.split('\n').filter(Boolean)
  return [...new Set([...changedPaths, ...remotePaths])].sort()
}

async function commitCycle(config: AutoflowConfig, runner: CommandRunner, cycle: number, changedPaths: string[]): Promise<string> {
  await git(config, runner, ['add', '--', ...changedPaths])
  const commit = await git(config, runner, [
    '-c',
    'user.name=claude-code-247-autoflow',
    '-c',
    'user.email=claude-code-247-autoflow@example.invalid',
    'commit',
    '-m',
    `[autoflow] cycle ${cycle}: workbook-guided update`,
  ])
  if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`)
  return (await git(config, runner, ['rev-parse', 'HEAD'])).stdout.trim()
}

async function runRemoteWriteStage(
  config: AutoflowConfig,
  runner: CommandRunner,
  cycle: number,
  cycleDir: string,
  commitSha: string,
): Promise<CommandResult> {
  const bodyFile = join(cycleDir, 'pull-request-body.md')
  writeFileSync(bodyFile, [
    `Autoflow cycle ${cycle}`,
    '',
    `Commit: ${commitSha}`,
    `Evidence: ${cycleDir}`,
    '',
    'This PR was created by Claude Code 247 autoflow after local gates passed.',
  ].join('\n') + '\n')

  const push = await runner.run('git', ['push', '-u', config.remoteName, config.branch], {
    cwd: config.worktreePath,
    timeoutMs: config.commandTimeoutMs,
  })
  writeCommandEvidence(cycleDir, 'remote-push-result.json', push)
  if (push.exitCode !== 0) return push

  const title = `[autoflow] cycle ${cycle}: workbook-guided update`
  const pr = await runner.run(config.ghBin, [
    'pr',
    'create',
    '--base',
    config.prBaseBranch,
    '--head',
    config.branch,
    '--title',
    title,
    '--body-file',
    bodyFile,
  ], { cwd: config.worktreePath, timeoutMs: config.commandTimeoutMs })
  writeCommandEvidence(cycleDir, 'remote-pr-create-result.json', pr)
  if (pr.exitCode !== 0) return pr

  if (config.remoteMode !== 'pr-merge') return pr

  const merge = await runner.run(config.ghBin, [
    'pr',
    'merge',
    config.branch,
    '--merge',
  ], { cwd: config.worktreePath, timeoutMs: config.commandTimeoutMs })
  writeCommandEvidence(cycleDir, 'remote-pr-merge-result.json', merge)
  return merge
}

function rotatedRemoteCycleLocation(config: Pick<AutoflowConfig, 'branch' | 'worktreePath'>, cycle: number): Pick<AutoflowState, 'branch' | 'worktreePath'> {
  const suffix = `cycle-${String(cycle).padStart(6, '0')}`
  const branchBase = config.branch.replace(/-cycle-\d{6}$/, '')
  const worktreeBase = config.worktreePath.replace(/-cycle-\d{6}$/, '')
  return {
    branch: `${branchBase}-${suffix}`,
    worktreePath: `${worktreeBase}-${suffix}`,
  }
}

async function git(config: AutoflowConfig, runner: CommandRunner, args: string[]): Promise<CommandResult> {
  return gitIn(config.worktreePath, runner, args, config.commandTimeoutMs)
}

async function gitIn(cwd: string, runner: CommandRunner, args: string[], timeoutMs: number): Promise<CommandResult> {
  const result = await runner.run('git', args, { cwd, timeoutMs })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result
}

async function recordFailureOrHold(
  config: AutoflowConfig,
  cycle: number,
  code: string,
  reason: string,
  cycleDir: string,
  state: AutoflowState,
): Promise<CycleResult> {
  const failed = {
    ...state,
    consecutiveFailures: state.consecutiveFailures + 1,
    consecutiveEmptyDiffs: 0,
    consecutiveNoProductiveChanges: 0,
  }
  if (failed.consecutiveFailures >= config.holdAfterConsecutiveFailures) {
    return hold(config, cycle, code, `${reason}; failure streak=${failed.consecutiveFailures}`, cycleDir, failed)
  }
  saveState(config, { ...failed, nextCycle: cycle + 1, currentCycle: undefined, lastCompletedAt: new Date().toISOString() })
  logEvent(config, { type: 'autoflow.cycle_failed_non_terminal', cycle, code, reason, streak: failed.consecutiveFailures })
  return { cycle, status: 'completed', evidenceDir: cycleDir }
}

async function hold(
  config: AutoflowConfig,
  cycle: number,
  code: string,
  reason: string,
  cycleDir: string,
  state: AutoflowState,
  summaryInput: Partial<Pick<WriteSummaryInput, 'changedPaths' | 'productivePaths' | 'gates' | 'stageDurationsMs'>> = {},
): Promise<CycleResult> {
  const record: HoldRecord = { code, reason, cycle, createdAt: new Date().toISOString() }
  writeFileSync(join(cycleDir, 'HOLD.json'), JSON.stringify(record, null, 2) + '\n')
  writeFileSync(join(cycleDir, 'HOLD.md'), [`# HOLD ${code}`, '', reason, ''].join('\n'))
  const heldState = { ...state, status: 'hold' as const, currentCycle: undefined, hold: record }
  saveState(config, heldState)
  writeAutoflowSummary(config, {
    status: 'hold',
    cycle,
    state: heldState,
    cycleDir,
    hold: record,
    changedPaths: summaryInput.changedPaths ?? [],
    productivePaths: summaryInput.productivePaths ?? [],
    gates: summaryInput.gates ?? [],
    stageDurationsMs: summaryInput.stageDurationsMs ?? {},
  })
  logEvent(config, { type: 'autoflow.hold', hold: record })
  return { cycle, status: 'hold', evidenceDir: cycleDir, hold: record }
}

function buildClaudePrompt(config: AutoflowConfig, state: AutoflowState, cycleDir: string): string {
  const previousCycle = state.nextCycle > 1 ? state.nextCycle - 1 : null
  const previousEvidenceDir = previousCycle === null ? null : join(config.evidenceDir, cycleIdFor(previousCycle))
  return [
    'You are Claude Code acting as the planner/reviewer side of a 24/7 local autoflow.',
    '',
    `Seed workbook: ${config.workbookPath}`,
    `Worktree workbook: ${join(config.worktreePath, 'WORKBOOK_v4.md')}`,
    `Cycle: ${state.nextCycle}`,
    `Evidence dir for this cycle: ${cycleDir}`,
    `Latest autoflow summary: ${config.summaryPath}`,
    previousEvidenceDir ? `Previous cycle evidence dir: ${previousEvidenceDir}` : 'Previous cycle evidence dir: none',
    state.lastCommitSha ? `Previous cycle commit: ${state.lastCommitSha}` : 'Previous cycle commit: none',
    state.lastCompletedAt ? `Previous cycle completed at: ${state.lastCompletedAt}` : 'Previous cycle completed at: none',
    renderPlannerSignalLine(config),
    '',
    'Allowed writes: WORKBOOK_v4.md and local autoflow planning/review artifacts only.',
    'Forbidden: git push, PR creation, merge, editing .env*, secrets/**, .github/**, AGENTS.md.',
    config.remoteMode === 'off'
      ? 'Remote stage is disabled for this run.'
      : 'Remote stage is supervisor-owned. For an auto-merge smoke, choose only a tiny source/test change; do not ask Codex to edit package files, lockfiles, scripts, docs, .github, secrets, or env files.',
    'Task:',
    '1. Read WORKBOOK_v4.md, especially §0 next_action.',
    '2. Review the previous cycle evidence dir when present and record the result in WORKBOOK_v4.md.',
    '3. Read the latest autoflow summary when present; if it reports repeated productive paths, choose a different product/harness slice or record a HOLD rationale instead of continuing the same narrow pattern.',
    '4. Choose the next bounded product/harness slice from the current workbook state.',
    '5. Update WORKBOOK_v4.md only when it improves machine-readable next_action/state.',
    '6. Emit concise JSON-compatible guidance for Codex: goal, constraints, acceptance checks, and risks.',
  ].join('\n')
}

function buildCodexPrompt(
  config: AutoflowConfig,
  cycle: number,
  attempt: number,
  cycleDir: string,
  claudeOutput: string,
  retryContext = '',
): string {
  return [
    'You are Codex acting as the coder/debugger side of a 24/7 local autoflow.',
    '',
    `Worktree: ${config.worktreePath}`,
    `Workbook: ${join(config.worktreePath, 'WORKBOOK_v4.md')}`,
    `Cycle: ${cycle}`,
    `Attempt: ${attempt}/${config.maxCodexRetries}`,
    `Evidence dir recorded by supervisor: ${cycleDir}`,
    '',
    'Forbidden: git push, gh pr create, gh pr merge, git merge, editing .env*, secrets/**, .github/**, AGENTS.md.',
    config.remoteMode === 'off'
      ? 'Remote stage is disabled for this run.'
      : 'Remote stage is handled by the autoflow supervisor after gates pass. Do not create PRs or merge. Keep the implementation to source/test files only; do not edit package files, lockfiles, scripts, docs, .github, secrets, or env files.',
    'Make local code/test/workbook changes needed to satisfy Claude guidance. Do not create remote side effects.',
    'Leave the repository ready for pnpm typecheck, pnpm lint, and pnpm test.',
    '',
    'Claude guidance:',
    claudeOutput || '(no Claude output captured)',
    '',
    'Previous failure context for this cycle:',
    retryContext || '(none; this is the first attempt)',
  ].join('\n')
}

function renderRetryContext(codex: CommandResult, gates: GateResult[]): string {
  const gateSummary = gates.map((gate) => [
    `Gate: ${gate.command}`,
    `Exit: ${gate.exitCode}`,
    gate.stdout.trim() ? `STDOUT:\n${gate.stdout.slice(0, 4000)}` : '',
    gate.stderr.trim() ? `STDERR:\n${gate.stderr.slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  return [
    `Codex exit: ${codex.exitCode}`,
    codex.stdout.trim() ? `Codex stdout:\n${codex.stdout.slice(0, 4000)}` : '',
    codex.stderr.trim() ? `Codex stderr:\n${codex.stderr.slice(0, 4000)}` : '',
    gateSummary,
  ].filter(Boolean).join('\n\n')
}

function isCodexUsageLimit(codex: CommandResult): boolean {
  return /usage limit/i.test(`${codex.stdout}\n${codex.stderr}`)
}

interface WriteSummaryInput {
  status: 'completed' | 'hold'
  cycle: number
  state: AutoflowState
  cycleDir: string
  commitSha?: string
  hold?: HoldRecord
  changedPaths: string[]
  productivePaths: string[]
  gates: GateResult[]
  stageDurationsMs: AutoflowSummary['stageDurationsMs']
}

function writeAutoflowSummary(config: AutoflowConfig, input: WriteSummaryInput): void {
  const repetition = analyzeRepetition(config, input.cycle, input.productivePaths)
  const plannerSignals = buildPlannerSignals(input, repetition)
  const summary: AutoflowSummary = {
    version: 1,
    updatedAt: new Date().toISOString(),
    status: input.status,
    cycle: input.cycle,
    nextCycle: input.state.nextCycle,
    branch: input.state.branch,
    worktreePath: input.state.worktreePath,
    evidenceDir: input.cycleDir,
    commitSha: input.commitSha,
    hold: input.hold,
    changedPaths: input.changedPaths,
    productivePaths: input.productivePaths,
    gates: input.gates.map((gate) => ({ command: gate.command, exitCode: gate.exitCode })),
    stageDurationsMs: input.stageDurationsMs,
    repetition,
    plannerSignals,
  }
  const rendered = JSON.stringify(summary, null, 2) + '\n'
  writeFileSync(join(input.cycleDir, 'autoflow-summary.json'), rendered)
  ensureDir(dirname(config.summaryPath))
  writeFileSync(config.summaryPath, rendered)
  logEvent(config, {
    type: 'autoflow.summary_written',
    cycle: input.cycle,
    summaryPath: config.summaryPath,
    plannerSignals,
  })
}

function analyzeRepetition(
  config: Pick<AutoflowConfig, 'evidenceDir'>,
  cycle: number,
  currentProductivePaths: string[],
): AutoflowSummary['repetition'] {
  const windowSize = 6
  const start = Math.max(1, cycle - windowSize + 1)
  const sets: string[][] = []
  for (let item = start; item <= cycle; item++) {
    if (item === cycle) {
      sets.push([...currentProductivePaths].sort())
      continue
    }
    sets.push(readProductivePathsForCycle(config, item))
  }

  const currentKey = pathSetKey(currentProductivePaths)
  let sameProductivePathStreak = 0
  for (let index = sets.length - 1; index >= 0; index--) {
    if (pathSetKey(sets[index]) !== currentKey || !currentKey) break
    sameProductivePathStreak++
  }

  const categoryCounts: Record<string, number> = {}
  for (const paths of sets) {
    for (const path of paths) {
      const category = categorizePath(path)
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1
    }
  }

  return {
    windowSize: sets.length,
    sameProductivePathStreak,
    repeatedProductivePaths: sameProductivePathStreak >= 2 ? [...currentProductivePaths].sort() : [],
    categoryCounts,
  }
}

function readProductivePathsForCycle(config: Pick<AutoflowConfig, 'evidenceDir'>, cycle: number): string[] {
  const file = join(config.evidenceDir, cycleIdFor(cycle), 'changed-paths.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { productivePaths?: string[] }
    return [...(parsed.productivePaths ?? [])].sort()
  } catch {
    return []
  }
}

function buildPlannerSignals(
  input: Pick<WriteSummaryInput, 'status' | 'hold' | 'productivePaths'>,
  repetition: AutoflowSummary['repetition'],
): string[] {
  const signals: string[] = []
  if (input.status === 'hold' && input.hold) {
    signals.push(`hold:${input.hold.code}`)
  }
  if (input.productivePaths.length === 0) {
    signals.push('no_productive_paths')
  }
  if (repetition.sameProductivePathStreak >= 3) {
    signals.push(`repeated_productive_paths:${repetition.sameProductivePathStreak}`)
  }
  if ((repetition.categoryCounts.test ?? 0) >= 4 && Object.keys(repetition.categoryCounts).length === 1) {
    signals.push('test_only_window')
  }
  return signals
}

function renderPlannerSignalLine(config: Pick<AutoflowConfig, 'summaryPath'>): string {
  if (!existsSync(config.summaryPath)) return 'Latest planner signals: none'
  try {
    const summary = JSON.parse(readFileSync(config.summaryPath, 'utf8')) as Pick<AutoflowSummary, 'plannerSignals'>
    return summary.plannerSignals.length > 0
      ? `Latest planner signals: ${summary.plannerSignals.join(', ')}`
      : 'Latest planner signals: none'
  } catch {
    return 'Latest planner signals: unavailable; summary could not be parsed'
  }
}

function pathSetKey(paths: string[]): string {
  return [...paths].sort().join('\0')
}

function categorizePath(path: string): string {
  if (path.includes('.test.') || path.startsWith('test/') || path.startsWith('tests/')) return 'test'
  if (path.startsWith('src/') || path.startsWith('app/') || path.startsWith('lib/')) return 'source'
  if (path.startsWith('docs/')) return 'docs'
  if (path.startsWith('scripts/')) return 'scripts'
  if (path === 'package.json' || path.endsWith('/package.json') || path.endsWith('lock.yaml') || path.endsWith('lock.json')) return 'package'
  if (path === 'WORKBOOK_v4.md' || path.startsWith('.aedev/')) return 'workbook'
  return 'other'
}

function writeCommandEvidence(dir: string, filename: string, result: CommandResult): void {
  writeFileSync(join(dir, filename), JSON.stringify({
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutChars: result.stdout.length,
    stderrChars: result.stderr.length,
  }, null, 2) + '\n')
}

function logEvent(config: Pick<AutoflowConfig, 'logPath'>, payload: Record<string, unknown>): void {
  ensureDir(dirname(config.logPath))
  appendFileSync(config.logPath, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n')
}

function isWorkbookOrAutoflowArtifact(path: string): boolean {
  return path === 'WORKBOOK_v4.md' || path.startsWith('.aedev/')
}

export function scrubRemoteWriteEnv(env: NodeJS.ProcessEnv, allowRemoteWrites = false): NodeJS.ProcessEnv {
  const safe = { ...env }
  safe['AEDEV_ALLOW_REMOTE_WRITES'] = allowRemoteWrites ? '1' : '0'
  if (!allowRemoteWrites) {
    delete safe['GITHUB_TOKEN']
    delete safe['GH_TOKEN']
  }
  return safe
}

function cycleIdFor(cycle: number): string {
  return `cycle-${String(cycle).padStart(6, '0')}`
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function localGitRefExists(repoRoot: string, refName: string): boolean {
  const gitDir = gitDirForRepo(repoRoot)
  if (!gitDir) return false
  const looseRef = join(gitDir, ...refName.split('/'))
  if (existsSync(looseRef)) return true
  const packedRefs = join(gitDir, 'packed-refs')
  if (!existsSync(packedRefs)) return false
  return readFileSync(packedRefs, 'utf8')
    .split('\n')
    .some((line) => line.trim().endsWith(` ${refName}`))
}

function gitDirForRepo(repoRoot: string): string | null {
  const dotGit = join(repoRoot, '.git')
  if (!existsSync(dotGit)) return null
  const stat = lstatSync(dotGit)
  if (stat.isDirectory()) return dotGit
  const match = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)\s*$/m)
  if (!match) return null
  return resolve(repoRoot, match[1])
}

function worktreeFetchTimeoutMs(config: Pick<AutoflowConfig, 'commandTimeoutMs'>): number {
  return Math.min(config.commandTimeoutMs, WORKTREE_FETCH_TIMEOUT_MS)
}

function parseList(raw: string | undefined, fallback: string[] = []): string[] {
  if (!raw) return [...fallback]
  return raw.split('||').map((item) => item.trim()).filter(Boolean)
}

function parseMaxCycles(raw: string | undefined): number | null {
  if (!raw || raw === 'infinite') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function parseBoolean(raw: string | undefined): boolean {
  if (!raw) return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

function parseRemoteWriteMode(raw: string | undefined): RemoteWriteMode {
  if (raw === 'pr' || raw === 'pr-merge') return raw
  return 'off'
}

function isMediumOrHighRiskRemoteWritePath(path: string): boolean {
  return (
    path === 'package.json' ||
    path.endsWith('/package.json') ||
    path === 'package-lock.json' ||
    path.endsWith('/package-lock.json') ||
    path === 'pnpm-lock.yaml' ||
    path.endsWith('/pnpm-lock.yaml') ||
    path === 'docs' ||
    path.startsWith('docs/') ||
    path === 'scripts' ||
    path.startsWith('scripts/') ||
    path.startsWith('auth/') ||
    path.includes('/auth/') ||
    path.startsWith('api/') ||
    path.includes('/api/') ||
    path.startsWith('app/api/') ||
    path.includes('/app/api/')
  )
}

function argValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  return idx >= 0 ? argv[idx + 1] : undefined
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
