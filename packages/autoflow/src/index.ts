import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export type AutoflowStatus = 'idle' | 'running' | 'hold'
export type RemoteWriteMode = 'off' | 'pr' | 'pr-merge'
export type CoderProvider = 'codex' | 'claude'

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
  coderProvider: CoderProvider
  setupCommands: string[]
  gateCommands: string[]
  forbiddenPatterns: string[]
  maxCycles: number | null
  maxCoderRetries: number
  holdAfterConsecutiveFailures: number
  holdAfterConsecutiveEmptyDiffs: number
  commandTimeoutMs: number
  worktreeFetchTimeoutMs: number
  setupFetchAttempts: number
  retainedCycleWorktrees: number
  runningStateTtlMs: number
  stageHeartbeatIntervalMs: number
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
  consecutiveSetupFetchTimeouts: number
  consecutiveClaudeTimeouts: number
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
  resumeAfter?: string
  retryCount?: number
  operatorHint?: string
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

export interface CommandRunOptions {
  cwd: string
  timeoutMs: number
  stdin?: string
  env?: NodeJS.ProcessEnv
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
  coderProvider?: CoderProvider
  usage?: AutoflowUsageSummary
  stageDurationsMs: {
    claude?: number
    coder?: number
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

export interface AutoflowUsageSummary {
  planner?: AutoflowStageUsage
  coder?: AutoflowStageUsage
  total: {
    costUsd: number | null
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
  }
}

export interface AutoflowStageUsage {
  provider: 'claude'
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  serviceTier?: string
  modelUsage?: Record<string, {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
    costUsd: number | null
  }>
}

export interface AutoflowDoctorReport {
  version: 1
  status: 'pass' | 'warn' | 'fail'
  generatedAt: string
  operatorAction: AutoflowOperatorAction
  launchd?: {
    label: string
    plistPath: string
    exists: boolean
    startInterval?: number
    workingDirectory?: string
    programArguments: string[]
    runtime?: LaunchdRuntimeStatus
  }
  cadence?: AutoflowCadenceStatus
  config: {
    coderProvider: CoderProvider
    remoteMode: RemoteWriteMode
    allowRemoteWrites: boolean
    branch: string
    prBaseBranch: string
    maxCycles: number | null
    setupCommands: string[]
    gateCommands: string[]
    setupFetchAttempts: number
    retainedCycleWorktrees: number
    runningStateTtlMs: number
    stageHeartbeatIntervalMs: number
  }
  paths: Record<string, { path: string; exists: boolean }>
  soak?: AutoflowSoakStatus
  state?: Pick<AutoflowState,
    | 'status'
    | 'nextCycle'
    | 'currentCycle'
    | 'branch'
    | 'worktreePath'
    | 'lastStartedAt'
    | 'lastCompletedAt'
    | 'lastCommitSha'
    | 'hold'
  >
  summary?: Pick<AutoflowSummary,
    | 'status'
    | 'cycle'
    | 'nextCycle'
    | 'coderProvider'
    | 'updatedAt'
    | 'commitSha'
    | 'plannerSignals'
    | 'changedPaths'
    | 'gates'
    | 'usage'
  >
  checks: Array<{ code: string; status: 'pass' | 'warn' | 'fail'; message: string }>
}

type AutoflowDoctorState = NonNullable<AutoflowDoctorReport['state']>
type AutoflowDoctorSummary = NonNullable<AutoflowDoctorReport['summary']>

export interface AutoflowSoakStatus {
  checked: boolean
  active: boolean
  runStartedAt?: string
  runAgeMs?: number
  latestHeartbeatAt?: string
  latestHeartbeatAgeMs?: number
  currentCycle?: number
  completedCycles: number[]
  completedCycleCount: number
  latestCompletedCycle?: number
  lastCompletedAt?: string
  holdCount: number
  autoResumeCount: number
  claudeStartedCount: number
  coderStartedCount: number
  cyclesWithUsage: number
  usage: AutoflowUsageSummary['total']
  notes: string[]
}

export interface AutoflowOperatorAction {
  severity: 'info' | 'warn' | 'fail'
  summary: string
  command?: string
  details?: string[]
}

interface LaunchdRegistration {
  label: string
  plistPath: string
  exists: boolean
  environment: NodeJS.ProcessEnv
  startInterval?: number
  workingDirectory?: string
  programArguments: string[]
  runtime?: LaunchdRuntimeStatus
}

export interface LaunchdRuntimeStatus {
  checked: boolean
  loaded: boolean
  state?: string
  runs?: number
  lastExitCode?: number
  pid?: number
  reason?: string
}

export interface AutoflowCadenceStatus {
  checked: boolean
  intervalSeconds?: number
  lastCompletedAt?: string
  nextExpectedAt?: string
  graceSeconds?: number
  overdue: boolean
  overdueMs?: number
  reason?: string
}

export interface CommandRunner {
  run(command: string, args: string[], opts: CommandRunOptions): Promise<CommandResult>
}

const DEFAULT_REPO_ROOT = '/Users/lanston/projects/claude-code-247'
const DEFAULT_BRANCH = 'codex/autoflow-workbook'
const DEFAULT_HOME = join(homedir(), '.claude-code-247', 'autoflow')
const DEFAULT_GATES = ['pnpm typecheck', 'pnpm lint', 'pnpm test']
const DEFAULT_FORBIDDEN = ['.env*', 'secrets/**', '.github/**', 'AGENTS.md']
const WORKTREE_FETCH_TIMEOUT_MS = 60_000
const DEFAULT_RETAINED_CYCLE_WORKTREES = 12
const DEFAULT_TIMEOUT_KILL_GRACE_MS = 2_000
const DEFAULT_STAGE_HEARTBEAT_INTERVAL_MS = 60_000
const DEFAULT_RUNNING_STATE_TTL_MS = 6 * 60 * 60_000
const TRANSIENT_SETUP_RESUME_DELAY_MS = 5 * 60_000
const MAX_TRANSIENT_SETUP_RESUME_DELAY_MS = 60 * 60_000
const TRANSIENT_CLAUDE_TIMEOUT_RESUME_DELAY_MS = 10 * 60_000
const MAX_TRANSIENT_CLAUDE_TIMEOUT_RESUME_DELAY_MS = 2 * 60 * 60_000

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
    coderProvider: parseCoderProvider(env['AEDEV_AUTOFLOW_CODER_PROVIDER']),
    setupCommands: parseList(env['AEDEV_AUTOFLOW_SETUP_COMMANDS']),
    gateCommands: parseList(env['AEDEV_AUTOFLOW_GATES'], DEFAULT_GATES),
    forbiddenPatterns: parseList(env['AEDEV_AUTOFLOW_FORBIDDEN'], DEFAULT_FORBIDDEN),
    maxCycles: parseMaxCycles(maxCyclesRaw),
    maxCoderRetries: Number(env['AEDEV_AUTOFLOW_CODER_RETRIES'] ?? env['AEDEV_AUTOFLOW_CODEX_RETRIES'] ?? '3'),
    holdAfterConsecutiveFailures: Number(env['AEDEV_AUTOFLOW_HOLD_AFTER_FAILURES'] ?? '3'),
    holdAfterConsecutiveEmptyDiffs: Number(env['AEDEV_AUTOFLOW_HOLD_AFTER_EMPTY_DIFFS'] ?? '3'),
    commandTimeoutMs: Number(env['AEDEV_AUTOFLOW_COMMAND_TIMEOUT_MS'] ?? '1800000'),
    worktreeFetchTimeoutMs: Number(env['AEDEV_AUTOFLOW_WORKTREE_FETCH_TIMEOUT_MS'] ?? WORKTREE_FETCH_TIMEOUT_MS),
    setupFetchAttempts: Number(env['AEDEV_AUTOFLOW_SETUP_FETCH_ATTEMPTS'] ?? '2'),
    retainedCycleWorktrees: Number(env['AEDEV_AUTOFLOW_RETAIN_CYCLE_WORKTREES'] ?? DEFAULT_RETAINED_CYCLE_WORKTREES),
    runningStateTtlMs: Number(env['AEDEV_AUTOFLOW_RUNNING_STATE_TTL_MS'] ?? DEFAULT_RUNNING_STATE_TTL_MS),
    stageHeartbeatIntervalMs: Number(env['AEDEV_AUTOFLOW_STAGE_HEARTBEAT_MS'] ?? DEFAULT_STAGE_HEARTBEAT_INTERVAL_MS),
    cycleSleepMs: Number(env['AEDEV_AUTOFLOW_CYCLE_SLEEP_MS'] ?? '0'),
    allowRemoteWrites: parseBoolean(env['AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES']),
    remoteMode: parseRemoteWriteMode(env['AEDEV_AUTOFLOW_REMOTE_MODE']),
    remoteName: env['AEDEV_AUTOFLOW_REMOTE_NAME'] ?? 'origin',
    prBaseBranch: env['AEDEV_AUTOFLOW_PR_BASE'] ?? 'main',
    rotateRemoteBranches: parseBoolean(env['AEDEV_AUTOFLOW_ROTATE_REMOTE_BRANCHES']),
  }
}

export async function runAutoflowCli(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv[0] === 'doctor' || argv.includes('--doctor')) {
    const launchdLabel = argValue(argv, '--launchd-label')
    const launchd = launchdLabel ? readLaunchdRegistration(launchdLabel, env) : undefined
    const configEnv = launchd ? { ...env, ...launchd.environment } : env
    const configArgv = launchd ? launchdAutoflowArgv(launchd.programArguments) : argv
    const config = defaultConfig(configEnv, configArgv)
    console.log(JSON.stringify(buildAutoflowDoctorReport(config, new Date(), launchd), null, 2))
    return
  }
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

export function buildAutoflowDoctorReport(config: AutoflowConfig, now = new Date(), launchd?: LaunchdRegistration): AutoflowDoctorReport {
  const paths = {
    repoRoot: pathStatus(config.repoRoot),
    workbookPath: pathStatus(config.workbookPath),
    statePath: pathStatus(config.statePath),
    summaryPath: pathStatus(config.summaryPath),
    logPath: pathStatus(config.logPath),
    evidenceDir: pathStatus(config.evidenceDir),
    worktreePath: pathStatus(config.worktreePath),
  }
  const checks: AutoflowDoctorReport['checks'] = [
    ...(launchd
      ? [launchd.exists
        ? { code: 'launchd_plist_found' as const, status: 'pass' as const, message: `launchd plist found: ${launchd.plistPath}` }
        : { code: 'launchd_plist_found' as const, status: 'fail' as const, message: `launchd plist missing: ${launchd.plistPath}` }]
      : []),
    ...(launchd?.runtime
      ? [launchd.runtime.loaded
        ? { code: 'launchd_runtime_loaded' as const, status: 'pass' as const, message: `launchd runtime is ${launchd.runtime.state ?? 'loaded'}` }
        : { code: 'launchd_runtime_loaded' as const, status: 'warn' as const, message: launchd.runtime.reason ?? 'launchd runtime is not loaded' }]
      : []),
    paths.repoRoot.exists
      ? { code: 'repo_root_exists', status: 'pass', message: `repo root found: ${config.repoRoot}` }
      : { code: 'repo_root_exists', status: 'fail', message: `repo root missing: ${config.repoRoot}` },
    paths.workbookPath.exists
      ? { code: 'workbook_exists', status: 'pass', message: `workbook found: ${config.workbookPath}` }
      : { code: 'workbook_exists', status: 'fail', message: `workbook missing: ${config.workbookPath}` },
    config.gateCommands.length > 0
      ? { code: 'gates_configured', status: 'pass', message: `${config.gateCommands.length} gate command(s) configured` }
      : { code: 'gates_configured', status: 'fail', message: 'no gate commands configured' },
    config.remoteMode !== 'off' && config.allowRemoteWrites
      ? { code: 'remote_writes_enabled', status: 'pass', message: `remote mode ${config.remoteMode} is enabled` }
      : { code: 'remote_writes_enabled', status: 'warn', message: 'remote writes are disabled or remote mode is off' },
    { code: 'coder_provider', status: 'pass', message: `coder provider is ${config.coderProvider}` },
  ]

  let state: AutoflowDoctorReport['state']
  if (paths.statePath.exists) {
    try {
      const parsedState = pickDoctorState(loadState(config))
      state = parsedState
      checks.push({ code: 'state_readable', status: 'pass', message: `state is ${parsedState.status}` })
      if (parsedState.status === 'running' && isRunningStateStaleAt(config, parsedState, now)) {
        checks.push({
          code: 'running_state_stale',
          status: 'warn',
          message: `running state is older than ttl ${config.runningStateTtlMs}ms`,
        })
      }
      if (parsedState.status === 'hold' && parsedState.hold) {
        checks.push({ code: 'state_hold', status: 'warn', message: `loop is on HOLD: ${parsedState.hold.code}` })
      }
    } catch (error) {
      checks.push({ code: 'state_readable', status: 'warn', message: `state could not be parsed: ${String(error)}` })
    }
  } else {
    checks.push({ code: 'state_readable', status: 'warn', message: `state file missing: ${config.statePath}` })
  }

  let summary: AutoflowDoctorReport['summary']
  if (paths.summaryPath.exists) {
    try {
      const parsedSummary = pickDoctorSummary(JSON.parse(readFileSync(config.summaryPath, 'utf8')) as AutoflowSummary)
      summary = parsedSummary
      checks.push({ code: 'summary_readable', status: 'pass', message: `latest summary is cycle ${parsedSummary.cycle}` })
      if (parsedSummary.coderProvider && parsedSummary.coderProvider !== config.coderProvider) {
        checks.push({
          code: 'summary_provider_mismatch',
          status: 'warn',
          message: `latest summary used ${parsedSummary.coderProvider}, current config uses ${config.coderProvider}`,
        })
      }
    } catch (error) {
      checks.push({ code: 'summary_readable', status: 'warn', message: `summary could not be parsed: ${String(error)}` })
    }
  } else {
    checks.push({ code: 'summary_readable', status: 'warn', message: `summary file missing: ${config.summaryPath}` })
  }

  const soak = buildSoakStatus(config, state, summary, now)
  if (soak.checked) {
    const heartbeatGraceMs = config.stageHeartbeatIntervalMs * 3
    if (soak.active && soak.latestHeartbeatAgeMs !== undefined) {
      checks.push(soak.latestHeartbeatAgeMs <= heartbeatGraceMs
        ? {
          code: 'soak_recent_heartbeat',
          status: 'pass',
          message: `active soak heartbeat is recent (${soak.latestHeartbeatAgeMs}ms old)`,
        }
        : {
          code: 'soak_recent_heartbeat',
          status: 'warn',
          message: `active soak heartbeat is stale (${soak.latestHeartbeatAgeMs}ms old)`,
        })
    }
    if (config.coderProvider === 'claude' && (soak.cyclesWithUsage > 0 || soak.completedCycleCount > 0 || soak.claudeStartedCount > 0)) {
      const burnedTokens = soak.usage.outputTokens + soak.usage.cacheCreationInputTokens + soak.usage.cacheReadInputTokens
      checks.push(burnedTokens > 0
        ? {
          code: 'soak_claude_usage_observed',
          status: 'pass',
          message: `observed Claude usage across ${soak.cyclesWithUsage} cycle(s): output=${soak.usage.outputTokens}, cacheRead=${soak.usage.cacheReadInputTokens}, cost=${soak.usage.costUsd ?? 'unknown'}`,
        }
        : {
          code: 'soak_claude_usage_observed',
          status: 'warn',
          message: 'Claude activity was observed but no Claude usage evidence was found yet',
        })
    }
    if (soak.runStartedAt || soak.completedCycleCount > 0 || soak.claudeStartedCount > 0) {
      checks.push(config.maxCycles === null
        ? { code: 'soak_continuous_mode', status: 'pass', message: 'autoflow is configured for continuous cycles' }
        : { code: 'soak_continuous_mode', status: 'warn', message: `autoflow is limited to maxCycles=${config.maxCycles}` })
    }
  }

  const cadence = buildCadenceStatus(launchd, state, now)
  if (cadence?.checked) {
    checks.push(cadence.overdue
      ? {
        code: 'launchd_cadence_recent',
        status: 'warn',
        message: cadence.reason ?? `last completed run is overdue by ${cadence.overdueMs ?? 0}ms`,
      }
      : {
        code: 'launchd_cadence_recent',
        status: 'pass',
        message: cadence.nextExpectedAt ? `next run expected around ${cadence.nextExpectedAt}` : 'cadence is configured',
      })
  }

  return {
    version: 1,
    status: overallDoctorStatus(checks),
    generatedAt: now.toISOString(),
    operatorAction: buildOperatorAction(config, launchd, state, summary, cadence, checks, soak),
    launchd: launchd ? {
      label: launchd.label,
      plistPath: launchd.plistPath,
      exists: launchd.exists,
      startInterval: launchd.startInterval,
      workingDirectory: launchd.workingDirectory,
      programArguments: launchd.programArguments,
      runtime: launchd.runtime,
    } : undefined,
    cadence,
    config: {
      coderProvider: config.coderProvider,
      remoteMode: config.remoteMode,
      allowRemoteWrites: config.allowRemoteWrites,
      branch: config.branch,
      prBaseBranch: config.prBaseBranch,
      maxCycles: config.maxCycles,
      setupCommands: config.setupCommands,
      gateCommands: config.gateCommands,
      setupFetchAttempts: config.setupFetchAttempts,
      retainedCycleWorktrees: config.retainedCycleWorktrees,
      runningStateTtlMs: config.runningStateTtlMs,
      stageHeartbeatIntervalMs: config.stageHeartbeatIntervalMs,
    },
    paths,
    soak,
    state,
    summary,
    checks,
  }
}

export async function runAutoflow(config: AutoflowConfig, runner: CommandRunner = new SpawnCommandRunner()): Promise<CycleResult[]> {
  ensureDir(dirname(config.statePath))
  ensureDir(dirname(config.logPath))
  ensureDir(config.evidenceDir)

  let state = loadState(config)
  if (state.status === 'hold') {
    const resumed = autoResumeHoldIfReady(config, state)
    if (resumed) {
      state = resumed
    } else {
      logEvent(config, { type: 'autoflow.already_on_hold', hold: state.hold ?? null })
      return []
    }
  }
  if (state.status === 'running') {
    const stale = isRunningStateStale(config, state)
    if (!stale) {
      logEvent(config, {
        type: 'autoflow.already_running',
        cycle: state.currentCycle ?? state.nextCycle,
        lastStartedAt: state.lastStartedAt,
      })
      return []
    }
    const recovered = { ...state, status: 'idle' as const, currentCycle: undefined }
    saveState(config, recovered)
    logEvent(config, {
      type: 'autoflow.stale_running_recovered',
      cycle: state.currentCycle ?? state.nextCycle,
      lastStartedAt: state.lastStartedAt,
      ttlMs: config.runningStateTtlMs,
    })
    state = recovered
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
    const activeState = {
      ...fresh,
      status: 'running' as const,
      currentCycle: fresh.nextCycle,
      lastStartedAt: new Date().toISOString(),
    }
    saveState(config, activeState)
    try {
      logEvent(config, {
        type: 'autoflow.prepare_worktree_started',
        cycle: fresh.nextCycle,
        branch: activeConfig.branch,
        worktreePath: activeConfig.worktreePath,
      })
      await prepareWorktree(activeConfig, runner, activeState, config)
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
      const setupHold = classifySetupHold(error as Error, activeState)
      const holdState = {
        ...activeState,
        consecutiveSetupFetchTimeouts: setupHold.code === 'SETUP_FETCH_TIMEOUT' || setupHold.code === 'SETUP_FETCH_TRANSIENT'
          ? setupHold.retryCount ?? activeState.consecutiveSetupFetchTimeouts
          : activeState.consecutiveSetupFetchTimeouts,
      }
      const result = await hold(config, cycle, setupHold.code, (error as Error).message, cycleDir, holdState, {
        resumeAfter: setupHold.resumeAfter,
        retryCount: setupHold.retryCount,
        operatorHint: buildSetupHoldOperatorHint(activeConfig, setupHold),
      })
      results.push(result)
      break
    }
    const result = await runOneCycle(activeConfig, runner, { ...activeState, consecutiveSetupFetchTimeouts: 0 })
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
  let latestUsage: AutoflowUsageSummary | undefined

  try {
    const claudePrompt = buildClaudePrompt(config, state, cycleDir)
    writeFileSync(join(cycleDir, 'claude-prompt.md'), claudePrompt)
    logEvent(config, { type: 'autoflow.claude_started', cycle, cycleDir })
    const claude = await runWithStageHeartbeat(config, cycle, 'claude', () => runClaude(config, runner, claudePrompt))
    logEvent(config, { type: 'autoflow.claude_completed', cycle, exitCode: claude.exitCode, durationMs: claude.durationMs })
    writeCommandEvidence(cycleDir, 'claude-result.json', claude)
    writeFileSync(join(cycleDir, 'claude-output.txt'), claude.stdout || claude.stderr || '')
    latestUsage = buildUsageSummary(extractClaudeUsage(claude))
    if (latestUsage) writeFileSync(join(cycleDir, 'model-usage.json'), JSON.stringify(latestUsage, null, 2) + '\n')
    if (claude.exitCode !== 0) {
      if (claude.exitCode === 124) {
        const timeoutHold = transientClaudeTimeoutHold(state)
        return await hold(config, cycle, 'CLAUDE_TIMEOUT', `Claude planner timed out after ${claude.durationMs}ms`, cycleDir, {
          ...state,
          consecutiveClaudeTimeouts: timeoutHold.retryCount,
        }, {
          usage: latestUsage,
          resumeAfter: timeoutHold.resumeAfter,
          retryCount: timeoutHold.retryCount,
          operatorHint: buildClaudeTimeoutOperatorHint(config, timeoutHold),
        })
      }
      return await hold(config, cycle, 'CLAUDE_FAILED', `Claude exited ${claude.exitCode}`, cycleDir, state, {
        usage: latestUsage,
      })
    }

    logEvent(config, { type: 'autoflow.post_claude_diff_started', cycle, baseSha })
    const claudeChanged = await listChangedPaths(config, runner, baseSha)
    logEvent(config, { type: 'autoflow.post_claude_diff_completed', cycle, changedPaths: claudeChanged })
    const badClaudePaths = claudeChanged.filter((path) => !isWorkbookOrAutoflowArtifact(path))
    if (badClaudePaths.length > 0) {
      return await hold(config, cycle, 'CLAUDE_SCOPE_VIOLATION', `Claude touched non-workbook paths: ${badClaudePaths.join(', ')}`, cycleDir, state, {
        usage: latestUsage,
      })
    }
    logEvent(config, { type: 'autoflow.workbook_sync_started', cycle })
    persistWorkbookSeed(config, cycleDir)
    logEvent(config, { type: 'autoflow.workbook_sync_completed', cycle })

    let coder: CommandResult | undefined
    let gates: GateResult[] = []
    let retryContext = ''
    for (let attempt = 1; attempt <= config.maxCoderRetries; attempt++) {
      logEvent(config, { type: 'autoflow.coder_prompt_started', cycle, attempt, provider: config.coderProvider })
      const coderPrompt = buildCoderPrompt(config, cycle, attempt, cycleDir, claude.stdout || claude.stderr, retryContext)
      writeFileSync(join(cycleDir, `coder-prompt-${attempt}.md`), coderPrompt)
      logEvent(config, { type: 'autoflow.coder_prompt_completed', cycle, attempt, provider: config.coderProvider })
      logEvent(config, { type: 'autoflow.coder_started', cycle, attempt, provider: config.coderProvider })
      if (config.coderProvider === 'codex') logEvent(config, { type: 'autoflow.codex_started', cycle, attempt })
      coder = await runWithStageHeartbeat(config, cycle, 'coder', () => runCoder(config, runner, coderPrompt), { attempt, provider: config.coderProvider })
      logEvent(config, { type: 'autoflow.coder_completed', cycle, attempt, provider: config.coderProvider, exitCode: coder.exitCode, durationMs: coder.durationMs })
      if (config.coderProvider === 'codex') logEvent(config, { type: 'autoflow.codex_completed', cycle, attempt, exitCode: coder.exitCode, durationMs: coder.durationMs })
      writeCommandEvidence(cycleDir, `coder-result-${attempt}.json`, coder)
      writeFileSync(join(cycleDir, `coder-output-${attempt}.txt`), coder.stdout || coder.stderr || '')
      latestUsage = buildUsageSummary(extractClaudeUsage(claude), config.coderProvider === 'claude' ? extractClaudeUsage(coder) : undefined)
      if (latestUsage) writeFileSync(join(cycleDir, 'model-usage.json'), JSON.stringify(latestUsage, null, 2) + '\n')
      if (config.coderProvider === 'codex') {
        writeCommandEvidence(cycleDir, `codex-result-${attempt}.json`, coder)
        writeFileSync(join(cycleDir, `codex-output-${attempt}.txt`), coder.stdout || coder.stderr || '')
      }
      if (coder.exitCode !== 0) {
        if (isCoderUsageLimit(config, coder)) {
          return await hold(config, cycle, coderUsageLimitCode(config), coder.stdout || coder.stderr || `${config.coderProvider} usage limit reached`, cycleDir, state, {
            stageDurationsMs: coderStageDurations(config, claude.durationMs, coder.durationMs),
            usage: latestUsage,
            resumeAfter: inferCoderUsageLimitResumeAfter(config, coder),
          })
        }
        retryContext = renderRetryContext(coder, [])
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
      if (coder.exitCode === 0 && gates.every((gate) => gate.exitCode === 0)) break
      retryContext = renderRetryContext(coder, gates)
    }

    if (!coder || coder.exitCode !== 0) {
      return await recordFailureOrHold(config, cycle, 'CODER_FAILED', `${config.coderProvider} coder exited ${coder?.exitCode ?? 'unknown'}`, cycleDir, state, {
        usage: latestUsage,
      })
    }
    const usage = buildUsageSummary(extractClaudeUsage(claude), config.coderProvider === 'claude' ? extractClaudeUsage(coder) : undefined)
    latestUsage = usage
    if (usage) writeFileSync(join(cycleDir, 'model-usage.json'), JSON.stringify(usage, null, 2) + '\n')
    const failingGate = gates.find((gate) => gate.exitCode !== 0)
    if (failingGate) {
      return await recordFailureOrHold(config, cycle, 'GATES_FAILED', `Gate failed: ${failingGate.command}`, cycleDir, state, {
        usage,
      })
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
        stageDurationsMs: coderStageDurations(config, claude.durationMs, coder.durationMs),
        usage,
      })
    }
    if (changedPaths.length === 0) {
      const emptyState = {
        ...state,
        consecutiveEmptyDiffs: state.consecutiveEmptyDiffs + 1,
        consecutiveNoProductiveChanges: state.consecutiveNoProductiveChanges + 1,
        consecutiveSetupFetchTimeouts: 0,
        consecutiveFailures: 0,
        consecutiveClaudeTimeouts: 0,
      }
      if (emptyState.consecutiveEmptyDiffs >= config.holdAfterConsecutiveEmptyDiffs) {
        return await hold(config, cycle, 'EMPTY_DIFF_STREAK', `No changed paths for ${emptyState.consecutiveEmptyDiffs} consecutive cycle(s)`, cycleDir, emptyState, {
          usage,
        })
      }
      const completedEmpty = {
        ...emptyState,
        status: 'idle' as const,
        nextCycle: cycle + 1,
        currentCycle: undefined,
        lastCompletedAt: new Date().toISOString(),
      }
      saveState(config, completedEmpty)
      writeAutoflowSummary(config, {
        status: 'completed',
        cycle,
        state: completedEmpty,
        cycleDir,
        changedPaths,
        productivePaths,
        gates,
        stageDurationsMs: coderStageDurations(config, claude.durationMs, coder.durationMs),
        usage,
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
        consecutiveSetupFetchTimeouts: 0,
        consecutiveClaudeTimeouts: 0,
      }
      if (noProductiveState.consecutiveNoProductiveChanges >= config.holdAfterConsecutiveEmptyDiffs) {
        return await hold(
          config,
          cycle,
          'NO_PRODUCTIVE_CHANGE',
          `No productive paths for ${noProductiveState.consecutiveNoProductiveChanges} consecutive cycle(s)`,
          cycleDir,
          noProductiveState,
          { usage },
        )
      }
      const completedNoProductive = {
        ...noProductiveState,
        status: 'idle' as const,
        nextCycle: cycle + 1,
        currentCycle: undefined,
        lastCompletedAt: new Date().toISOString(),
      }
      saveState(config, completedNoProductive)
      writeAutoflowSummary(config, {
        status: 'completed',
        cycle,
        state: completedNoProductive,
        cycleDir,
        changedPaths,
        productivePaths,
        gates,
        stageDurationsMs: coderStageDurations(config, claude.durationMs, coder.durationMs),
        usage,
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
        stageDurationsMs: coderStageDurations(config, claude.durationMs, coder.durationMs),
        usage,
      })
    }

    const pathsToCommit = remotePlan.allowed ? productivePaths : changedPaths
    const commitSha = await commitCycle(config, runner, cycle, pathsToCommit, baseSha)
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
          stageDurationsMs: coderStageDurations(config, claude.durationMs, coder.durationMs, remoteWrite.durationMs),
          usage,
        })
      }
    }

    const nextCycle = cycle + 1
    const nextLocation = remotePlan.allowed && config.remoteMode === 'pr-merge' && shouldRotateRemoteBranches(config)
      ? rotatedRemoteCycleLocation(config, nextCycle)
      : { branch: state.branch, worktreePath: state.worktreePath }
    const completed = {
      ...state,
      status: 'idle' as const,
      nextCycle,
      currentCycle: undefined,
      consecutiveFailures: 0,
      consecutiveEmptyDiffs: 0,
      consecutiveNoProductiveChanges: 0,
      consecutiveSetupFetchTimeouts: 0,
      consecutiveClaudeTimeouts: 0,
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
      stageDurationsMs: coderStageDurations(config, claude.durationMs, coder.durationMs, remoteWriteDurationMs),
      usage,
    })
    logEvent(config, { type: 'autoflow.cycle_completed', cycle, commitSha, changedPaths })
    await pruneOldCycleWorktrees(config, runner, cycle)
    return { cycle, status: 'completed', evidenceDir: cycleDir, commitSha }
  } catch (error) {
    return await recordFailureOrHold(config, cycle, 'CYCLE_ERROR', (error as Error).message, cycleDir, state, {
      usage: latestUsage,
    })
  }
}

export function loadState(config: Pick<AutoflowConfig, 'statePath' | 'branch' | 'worktreePath'>): AutoflowState {
  if (!existsSync(config.statePath)) {
    return {
      version: 1,
      status: 'idle',
      nextCycle: 1,
      branch: config.branch,
      worktreePath: config.worktreePath,
      seeded: false,
      consecutiveFailures: 0,
      consecutiveEmptyDiffs: 0,
      consecutiveNoProductiveChanges: 0,
      consecutiveSetupFetchTimeouts: 0,
      consecutiveClaudeTimeouts: 0,
    }
  }
  const parsed = JSON.parse(readFileSync(config.statePath, 'utf8')) as AutoflowState
  const normalizedStatus = parsed.status === 'running' && parsed.currentCycle === undefined && !parsed.hold
    ? 'idle'
    : parsed.status
  return {
    ...parsed,
    status: normalizedStatus,
    branch: parsed.branch || config.branch,
    worktreePath: parsed.worktreePath || config.worktreePath,
    consecutiveNoProductiveChanges: parsed.consecutiveNoProductiveChanges ?? 0,
    consecutiveSetupFetchTimeouts: parsed.consecutiveSetupFetchTimeouts ?? 0,
    consecutiveClaudeTimeouts: parsed.consecutiveClaudeTimeouts ?? 0,
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

  run(command: string, args: string[], opts: CommandRunOptions): Promise<CommandResult> {
    if (shouldBlockRemoteWrite(command, args, this.opts.allowRemoteWrites ?? false)) {
      throw new Error(`remote write command blocked: ${command} ${args.join(' ')}`)
    }
    const started = Date.now()
    return new Promise((resolveCommand) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: scrubRemoteWriteEnv({ ...process.env, ...(opts.env ?? {}) }, this.opts.allowRemoteWrites ?? false),
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
  const coderBins = config.coderProvider === 'codex' ? [config.codexBin] : []
  const bins = config.remoteMode === 'off'
    ? [config.claudeBin, ...coderBins, config.pnpmBin, 'git']
    : [config.claudeBin, ...coderBins, config.pnpmBin, config.ghBin, 'git']
  for (const bin of bins) {
    const result = await runner.run('/usr/bin/which', [bin], { cwd: config.repoRoot, timeoutMs: 5000 })
    if (result.exitCode !== 0) throw new Error(`required CLI not found: ${bin}`)
  }
}

async function ensureWorktree(
  config: AutoflowConfig,
  runner: CommandRunner,
  stateConfig?: Pick<AutoflowConfig, 'logPath'>,
  cycle?: number,
): Promise<void> {
  ensureDir(dirname(config.worktreePath))
  if (existsSync(join(config.worktreePath, '.git'))) {
    const currentBranch = readWorktreeHeadBranch(config.worktreePath)
    if (currentBranch !== config.branch) {
      await gitIn(config.worktreePath, runner, ['switch', config.branch], config.commandTimeoutMs)
    }
    return
  }
  if (existsSync(config.worktreePath)) {
    throw new Error(`worktree path exists but is not a git worktree: ${config.worktreePath}`)
  }
  if (!localGitRefExists(config.repoRoot, `refs/heads/${config.branch}`)) {
    if (config.remoteMode !== 'off') {
      const timeoutMs = worktreeFetchTimeoutMs(config)
      const maxAttempts = setupFetchAttempts(config)
      const fetchEnv = nonInteractiveGitEnv()
      let fetch: CommandResult | undefined
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (stateConfig && cycle !== undefined) {
          logEvent(stateConfig, {
            type: 'autoflow.setup_fetch_started',
            cycle,
            attempt,
            maxAttempts,
            remoteName: config.remoteName,
            baseBranch: config.prBaseBranch,
            timeoutMs,
            nonInteractive: true,
          })
        }
        fetch = await runner.run('git', ['fetch', config.remoteName, config.prBaseBranch], {
          cwd: config.repoRoot,
          timeoutMs,
          env: fetchEnv,
        })
        if (stateConfig && cycle !== undefined) {
          logEvent(stateConfig, {
            type: 'autoflow.setup_fetch_completed',
            cycle,
            attempt,
            maxAttempts,
            remoteName: config.remoteName,
            baseBranch: config.prBaseBranch,
            exitCode: fetch.exitCode,
            durationMs: fetch.durationMs,
            timeoutMs,
            nonInteractive: true,
            stderr: summarizeCommandOutput(fetch.stderr),
            stdout: summarizeCommandOutput(fetch.stdout),
          })
        }
        if (fetch.exitCode !== 124 || attempt === maxAttempts) break
      }
      if (!fetch) throw new Error(`git fetch did not run while preparing base ${config.remoteName}/${config.prBaseBranch}`)
      if (fetch.exitCode === 124) {
        throw new Error(`git fetch timed out after ${timeoutMs}ms while preparing base ${config.remoteName}/${config.prBaseBranch} after ${maxAttempts} attempt(s)`)
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

function readWorktreeHeadBranch(worktreePath: string): string | undefined {
  const gitPath = join(worktreePath, '.git')
  try {
    let gitDir = gitPath
    if (lstatSync(gitPath).isFile()) {
      const gitFile = readFileSync(gitPath, 'utf8').trim()
      const match = /^gitdir:\s*(.+)$/i.exec(gitFile)
      if (!match) return undefined
      gitDir = resolve(dirname(gitPath), match[1])
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    const refPrefix = 'ref: refs/heads/'
    return head.startsWith(refPrefix) ? head.slice(refPrefix.length) : undefined
  } catch {
    return undefined
  }
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
  await ensureWorktree(activeConfig, runner, stateConfig, cycle)
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

async function runCoder(config: AutoflowConfig, runner: CommandRunner, prompt: string): Promise<CommandResult> {
  if (config.coderProvider === 'claude') {
    return runner.run(config.claudeBin, buildClaudeArgs(config), {
      cwd: config.worktreePath,
      timeoutMs: config.commandTimeoutMs,
      stdin: prompt,
    })
  }
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
  const committed = await runner.run('git', ['diff', '--name-only', `${baseSha}..HEAD`], {
    cwd: config.worktreePath,
    timeoutMs: config.commandTimeoutMs,
  })
  const status = await runner.run('git', ['status', '--porcelain=v1'], {
    cwd: config.worktreePath,
    timeoutMs: config.commandTimeoutMs,
  })
  if (committed.exitCode !== 0 && status.exitCode !== 0) {
    throw new Error([
      `git diff --name-only ${baseSha}..HEAD failed (exit ${committed.exitCode}): ${summarizeCommandOutput(committed.stderr || committed.stdout) ?? 'no output'}`,
      `git status --porcelain=v1 failed (exit ${status.exitCode}): ${summarizeCommandOutput(status.stderr || status.stdout) ?? 'no output'}`,
    ].join('; '))
  }
  const paths = [
    ...(committed.exitCode === 0 ? committed.stdout.split('\n').filter(Boolean) : []),
    ...(status.exitCode === 0 ? status.stdout.split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, '')) : []),
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

async function commitCycle(config: AutoflowConfig, runner: CommandRunner, cycle: number, changedPaths: string[], baseSha: string): Promise<string> {
  await git(config, runner, ['add', '--', ...changedPaths])
  const commit = await runner.run('git', [
    '-c',
    'user.name=claude-code-247-autoflow',
    '-c',
    'user.email=claude-code-247-autoflow@example.invalid',
    'commit',
    '-m',
    `[autoflow] cycle ${cycle}: workbook-guided update`,
  ], { cwd: config.worktreePath, timeoutMs: config.commandTimeoutMs })
  const head = (await git(config, runner, ['rev-parse', 'HEAD'])).stdout.trim()
  if (commit.exitCode !== 0) {
    const text = `${commit.stderr}\n${commit.stdout}`
    if (/(nothing to commit|no changes added to commit)/i.test(text) && head && head !== baseSha) return head
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`)
  }
  return head
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

function shouldRotateRemoteBranches(config: Pick<AutoflowConfig, 'maxCycles' | 'rotateRemoteBranches'>): boolean {
  return config.rotateRemoteBranches || config.maxCycles === null
}

async function pruneOldCycleWorktrees(
  config: Pick<AutoflowConfig, 'repoRoot' | 'worktreePath' | 'retainedCycleWorktrees' | 'commandTimeoutMs' | 'logPath'>,
  runner: CommandRunner,
  completedCycle: number,
): Promise<void> {
  try {
    const retain = Math.floor(config.retainedCycleWorktrees)
    if (!Number.isFinite(retain) || retain <= 0) return
    const worktreeBase = config.worktreePath.replace(/-cycle-\d{6}$/, '')
    const parent = dirname(worktreeBase)
    if (!existsSync(parent)) return
    const baseName = worktreeBase.slice(parent.length + 1)
    const candidates = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const match = entry.name.match(new RegExp(`^${escapeRegExp(baseName)}-cycle-(\\d{6})$`))
        if (!match) return null
        return {
          cycle: Number(match[1]),
          path: join(parent, entry.name),
        }
      })
      .filter((entry): entry is { cycle: number; path: string } => entry !== null && Number.isFinite(entry.cycle))
      .filter((entry) => entry.cycle <= completedCycle && entry.path !== config.worktreePath)
      .sort((a, b) => a.cycle - b.cycle)
    const removeCount = candidates.length - retain
    if (removeCount <= 0) return
    const stale = candidates.slice(0, removeCount)
    logEvent(config, {
      type: 'autoflow.cycle_worktree_prune_started',
      completedCycle,
      retain,
      candidates: candidates.length,
      removing: stale.length,
    })
    let removed = 0
    for (const entry of stale) {
      const result = await runner.run('git', ['worktree', 'remove', '--force', entry.path], {
        cwd: config.repoRoot,
        timeoutMs: config.commandTimeoutMs,
      })
      if (result.exitCode === 0) {
        removed++
        continue
      }
      logEvent(config, {
        type: 'autoflow.cycle_worktree_prune_failed',
        completedCycle,
        path: entry.path,
        exitCode: result.exitCode,
        stderr: summarizeCommandOutput(result.stderr),
        stdout: summarizeCommandOutput(result.stdout),
      })
    }
    logEvent(config, {
      type: 'autoflow.cycle_worktree_prune_completed',
      completedCycle,
      retain,
      removed,
      attempted: stale.length,
    })
  } catch (error) {
    logEvent(config, {
      type: 'autoflow.cycle_worktree_prune_error',
      completedCycle,
      reason: (error as Error).message,
    })
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
  summaryInput: Partial<Pick<WriteSummaryInput, 'usage'>> = {},
): Promise<CycleResult> {
  const failed = {
    ...state,
    consecutiveFailures: state.consecutiveFailures + 1,
    consecutiveEmptyDiffs: 0,
    consecutiveNoProductiveChanges: 0,
    consecutiveSetupFetchTimeouts: 0,
  }
  if (failed.consecutiveFailures >= config.holdAfterConsecutiveFailures) {
    return hold(config, cycle, code, `${reason}; failure streak=${failed.consecutiveFailures}`, cycleDir, failed, summaryInput)
  }
  saveState(config, {
    ...failed,
    status: 'idle',
    nextCycle: cycle + 1,
    currentCycle: undefined,
    lastCompletedAt: new Date().toISOString(),
  })
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
  summaryInput: Partial<Pick<WriteSummaryInput, 'changedPaths' | 'productivePaths' | 'gates' | 'stageDurationsMs' | 'usage'>> & { resumeAfter?: string; retryCount?: number; operatorHint?: string } = {},
): Promise<CycleResult> {
  const record: HoldRecord = { code, reason, cycle, createdAt: new Date().toISOString() }
  if (summaryInput.resumeAfter) record.resumeAfter = summaryInput.resumeAfter
  if (summaryInput.retryCount) record.retryCount = summaryInput.retryCount
  if (summaryInput.operatorHint) record.operatorHint = summaryInput.operatorHint
  writeFileSync(join(cycleDir, 'HOLD.json'), JSON.stringify(record, null, 2) + '\n')
  writeFileSync(join(cycleDir, 'HOLD.md'), renderHoldMarkdown(record))
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
    usage: summaryInput.usage,
  })
  logEvent(config, { type: 'autoflow.hold', hold: record })
  return { cycle, status: 'hold', evidenceDir: cycleDir, hold: record }
}

function buildClaudePrompt(config: AutoflowConfig, state: AutoflowState, cycleDir: string): string {
  const previousCycle = state.nextCycle > 1 ? state.nextCycle - 1 : null
  const previousEvidenceDir = previousCycle === null ? null : join(config.evidenceDir, cycleIdFor(previousCycle))
  const coderRoleName = config.coderProvider === 'claude' ? 'Claude Code coder' : 'Codex'
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
      : `Remote stage is supervisor-owned. For an auto-merge smoke, choose only a tiny source/test change; do not ask ${coderRoleName} to edit package files, lockfiles, scripts, docs, .github, secrets, or env files.`,
    'Task:',
    '1. Read WORKBOOK_v4.md, especially §0 next_action.',
    '2. Review the previous cycle evidence dir when present and record the result in WORKBOOK_v4.md.',
    '3. Read the latest autoflow summary when present; if it reports repeated productive paths, choose a different product/harness slice or record a HOLD rationale instead of continuing the same narrow pattern.',
    '   If latest planner signals include test_heavy_window, prefer a tiny source-facing product improvement with matching tests instead of another test-only slice, unless the workbook identifies a higher-risk gap that must be tested first.',
    '4. Choose the next bounded product/harness slice from the current workbook state.',
    '5. Update WORKBOOK_v4.md only when it improves machine-readable next_action/state.',
    `6. Emit concise JSON-compatible guidance for ${coderRoleName}: goal, constraints, acceptance checks, and risks.`,
  ].join('\n')
}

function buildCoderPrompt(
  config: AutoflowConfig,
  cycle: number,
  attempt: number,
  cycleDir: string,
  claudeOutput: string,
  retryContext = '',
): string {
  const roleName = config.coderProvider === 'claude'
    ? 'Claude Code'
    : 'Codex'
  return [
    `You are ${roleName} acting as the coder/debugger side of a 24/7 local autoflow.`,
    '',
    `Worktree: ${config.worktreePath}`,
    `Workbook: ${join(config.worktreePath, 'WORKBOOK_v4.md')}`,
    `Cycle: ${cycle}`,
    `Attempt: ${attempt}/${config.maxCoderRetries}`,
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

function renderRetryContext(coder: CommandResult, gates: GateResult[]): string {
  const gateSummary = gates.map((gate) => [
    `Gate: ${gate.command}`,
    `Exit: ${gate.exitCode}`,
    gate.stdout.trim() ? `STDOUT:\n${gate.stdout.slice(0, 4000)}` : '',
    gate.stderr.trim() ? `STDERR:\n${gate.stderr.slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  return [
    `Coder exit: ${coder.exitCode}`,
    coder.stdout.trim() ? `Coder stdout:\n${coder.stdout.slice(0, 4000)}` : '',
    coder.stderr.trim() ? `Coder stderr:\n${coder.stderr.slice(0, 4000)}` : '',
    gateSummary,
  ].filter(Boolean).join('\n\n')
}

function isCoderUsageLimit(config: Pick<AutoflowConfig, 'coderProvider'>, coder: CommandResult): boolean {
  if (config.coderProvider === 'codex') return /usage limit/i.test(`${coder.stdout}\n${coder.stderr}`)
  return /usage limit|rate limit|quota/i.test(`${coder.stdout}\n${coder.stderr}`)
}

function coderUsageLimitCode(config: Pick<AutoflowConfig, 'coderProvider'>): string {
  return config.coderProvider === 'codex' ? 'CODEX_USAGE_LIMIT' : 'CLAUDE_CODER_USAGE_LIMIT'
}

function inferCoderUsageLimitResumeAfter(_config: Pick<AutoflowConfig, 'coderProvider'>, coder: CommandResult): string | undefined {
  const text = `${coder.stdout}\n${coder.stderr}`
  const match = text.match(/try again at ([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return undefined
  const [, monthName, dayRaw, yearRaw, hourRaw, minuteRaw, ampm] = match
  const month = monthIndex(monthName)
  if (month === undefined) return undefined
  let hour = Number(hourRaw)
  if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0
  const parsed = new Date(Number(yearRaw), month, Number(dayRaw), hour, Number(minuteRaw), 0, 0)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

function monthIndex(monthName: string): number | undefined {
  const months = new Map([
    ['jan', 0],
    ['feb', 1],
    ['mar', 2],
    ['apr', 3],
    ['may', 4],
    ['jun', 5],
    ['jul', 6],
    ['aug', 7],
    ['sep', 8],
    ['oct', 9],
    ['nov', 10],
    ['dec', 11],
  ])
  return months.get(monthName.slice(0, 3).toLowerCase())
}

function autoResumeHoldIfReady(config: AutoflowConfig, state: AutoflowState): AutoflowState | null {
  const hold = state.hold
  if (!hold || !isAutoResumableHold(hold) || !hold.resumeAfter) return null
  const resumeAfterMs = Date.parse(hold.resumeAfter)
  if (Number.isNaN(resumeAfterMs) || resumeAfterMs > Date.now()) return null
  const resumed = {
    ...state,
    status: 'idle' as const,
    hold: undefined,
    consecutiveFailures: 0,
  }
  saveState(config, resumed)
  logEvent(config, { type: 'autoflow.hold_auto_resumed', hold, resumeAfter: hold.resumeAfter })
  return resumed
}

function isRunningStateStale(
  config: Pick<AutoflowConfig, 'commandTimeoutMs' | 'logPath' | 'runningStateTtlMs' | 'stageHeartbeatIntervalMs'>,
  state: Pick<AutoflowState, 'currentCycle' | 'lastStartedAt' | 'nextCycle'>,
): boolean {
  return isRunningStateStaleAt(config, state, new Date())
}

function isAutoResumableHold(hold: HoldRecord): boolean {
  return hold.code === 'CODEX_USAGE_LIMIT'
    || hold.code === 'SETUP_FETCH_TIMEOUT'
    || hold.code === 'SETUP_FETCH_TRANSIENT'
    || hold.code === 'CLAUDE_TIMEOUT'
}

function classifySetupHold(error: Error, state: Pick<AutoflowState, 'consecutiveSetupFetchTimeouts'>): { code: string; resumeAfter?: string; retryCount?: number } {
  if (/git fetch timed out/i.test(error.message)) {
    return transientSetupFetchHold('SETUP_FETCH_TIMEOUT', state)
  }
  if (/git fetch failed[\s\S]*(unable to read current working directory|operation not permitted|no such file or directory)/i.test(error.message)) {
    return transientSetupFetchHold('SETUP_FETCH_TRANSIENT', state)
  }
  return { code: 'SETUP_FAILED' }
}

function buildSetupHoldOperatorHint(
  config: Pick<AutoflowConfig, 'repoRoot' | 'remoteName' | 'prBaseBranch'>,
  hold: Pick<HoldRecord, 'code' | 'retryCount'>,
): string | undefined {
  if (hold.code !== 'SETUP_FETCH_TIMEOUT' && hold.code !== 'SETUP_FETCH_TRANSIENT') return undefined
  const fetchCommand = `git -C ${config.repoRoot} fetch ${config.remoteName} ${config.prBaseBranch}`
  const retryLabel = hold.retryCount && hold.retryCount >= 3
    ? `repeated setup fetch issue after ${hold.retryCount} retries`
    : 'transient setup fetch issue'
  return `${retryLabel}; verify repository fetch health with: ${fetchCommand}. If it succeeds, wait for resumeAfter or move hold.resumeAfter into the past and kick the launchd job.`
}

function buildClaudeTimeoutOperatorHint(
  config: Pick<AutoflowConfig, 'commandTimeoutMs' | 'stageHeartbeatIntervalMs'>,
  hold: Pick<HoldRecord, 'retryCount'>,
): string {
  const retryLabel = hold.retryCount && hold.retryCount >= 3
    ? `repeated Claude planner timeout after ${hold.retryCount} retries`
    : 'transient Claude planner timeout'
  return `${retryLabel}; command timeout is ${config.commandTimeoutMs}ms and heartbeat interval is ${config.stageHeartbeatIntervalMs}ms. Wait for resumeAfter or move hold.resumeAfter into the past and kick the launchd job.`
}

function renderHoldMarkdown(record: HoldRecord): string {
  const lines = [`# HOLD ${record.code}`, '', record.reason, '']
  if (record.retryCount) lines.push(`Retry count: ${record.retryCount}`, '')
  if (record.resumeAfter) lines.push(`Resume after: ${record.resumeAfter}`, '')
  if (record.operatorHint) lines.push('Operator hint:', '', record.operatorHint, '')
  return lines.join('\n')
}

function transientSetupFetchHold(code: string, state: Pick<AutoflowState, 'consecutiveSetupFetchTimeouts'>): { code: string; resumeAfter: string; retryCount: number } {
  const retryCount = state.consecutiveSetupFetchTimeouts + 1
  return {
    code,
    resumeAfter: new Date(Date.now() + setupFetchTimeoutResumeDelayMs(retryCount)).toISOString(),
    retryCount,
  }
}

function transientClaudeTimeoutHold(state: Pick<AutoflowState, 'consecutiveClaudeTimeouts'>): { code: string; resumeAfter: string; retryCount: number } {
  const retryCount = state.consecutiveClaudeTimeouts + 1
  return {
    code: 'CLAUDE_TIMEOUT',
    resumeAfter: new Date(Date.now() + claudeTimeoutResumeDelayMs(retryCount)).toISOString(),
    retryCount,
  }
}

function setupFetchTimeoutResumeDelayMs(retryCount: number): number {
  return Math.min(
    TRANSIENT_SETUP_RESUME_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
    MAX_TRANSIENT_SETUP_RESUME_DELAY_MS,
  )
}

function claudeTimeoutResumeDelayMs(retryCount: number): number {
  return Math.min(
    TRANSIENT_CLAUDE_TIMEOUT_RESUME_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
    MAX_TRANSIENT_CLAUDE_TIMEOUT_RESUME_DELAY_MS,
  )
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
  usage?: AutoflowUsageSummary
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
    coderProvider: config.coderProvider,
    usage: input.usage,
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

function coderStageDurations(config: Pick<AutoflowConfig, 'coderProvider'>, claudeMs: number, coderMs: number, remoteWriteMs?: number): AutoflowSummary['stageDurationsMs'] {
  return {
    claude: claudeMs,
    coder: coderMs,
    codex: config.coderProvider === 'codex' ? coderMs : undefined,
    remoteWrite: remoteWriteMs,
  }
}

function extractClaudeUsage(result: CommandResult): AutoflowStageUsage | undefined {
  if (!result.stdout.trim()) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result.stdout) as Record<string, unknown>
  } catch {
    return undefined
  }
  const usage = asRecord(parsed['usage'])
  const modelUsage = asRecord(parsed['modelUsage'])
  const inputTokens = numberField(usage, 'input_tokens')
  const outputTokens = numberField(usage, 'output_tokens')
  const cacheCreationInputTokens = numberField(usage, 'cache_creation_input_tokens')
  const cacheReadInputTokens = numberField(usage, 'cache_read_input_tokens')
  const breakdown: AutoflowStageUsage['modelUsage'] = {}
  for (const [model, raw] of Object.entries(modelUsage)) {
    const fields = asRecord(raw)
    breakdown[model] = {
      inputTokens: numberField(fields, 'inputTokens'),
      outputTokens: numberField(fields, 'outputTokens'),
      cacheCreationInputTokens: numberField(fields, 'cacheCreationInputTokens'),
      cacheReadInputTokens: numberField(fields, 'cacheReadInputTokens'),
      costUsd: nullableNumberField(fields, 'costUSD'),
    }
  }
  return {
    provider: 'claude',
    costUsd: nullableNumberField(parsed, 'total_cost_usd'),
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    serviceTier: typeof usage['service_tier'] === 'string' ? usage['service_tier'] : undefined,
    modelUsage: Object.keys(breakdown).length > 0 ? breakdown : undefined,
  }
}

function buildUsageSummary(planner?: AutoflowStageUsage, coder?: AutoflowStageUsage): AutoflowUsageSummary | undefined {
  if (!planner && !coder) return undefined
  const stages = [planner, coder].filter((stage): stage is AutoflowStageUsage => stage !== undefined)
  const costs = stages.map((stage) => stage.costUsd).filter((cost): cost is number => typeof cost === 'number')
  return {
    planner,
    coder,
    total: {
      costUsd: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
      inputTokens: stages.reduce((sum, stage) => sum + stage.inputTokens, 0),
      outputTokens: stages.reduce((sum, stage) => sum + stage.outputTokens, 0),
      cacheCreationInputTokens: stages.reduce((sum, stage) => sum + stage.cacheCreationInputTokens, 0),
      cacheReadInputTokens: stages.reduce((sum, stage) => sum + stage.cacheReadInputTokens, 0),
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function runWithStageHeartbeat<T>(
  config: Pick<AutoflowConfig, 'logPath' | 'stageHeartbeatIntervalMs'>,
  cycle: number,
  stage: string,
  operation: () => Promise<T>,
  details: Record<string, unknown> = {},
): Promise<T> {
  const intervalMs = config.stageHeartbeatIntervalMs
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return operation()

  const startedAt = Date.now()
  const heartbeat = setInterval(() => {
    logEvent(config, {
      type: 'autoflow.stage_heartbeat',
      cycle,
      stage,
      elapsedMs: Date.now() - startedAt,
      ...details,
    })
  }, intervalMs)
  heartbeat.unref?.()

  try {
    return await operation()
  } finally {
    clearInterval(heartbeat)
  }
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
    if ((input.hold.code === 'SETUP_FETCH_TIMEOUT' || input.hold.code === 'SETUP_FETCH_TRANSIENT') && (input.hold.retryCount ?? 0) >= 3) {
      signals.push(`setup_fetch_repeated:${input.hold.retryCount}`)
    }
    if ((input.hold.code === 'SETUP_FETCH_TIMEOUT' || input.hold.code === 'SETUP_FETCH_TRANSIENT') && setupFetchTimeoutResumeDelayMs(input.hold.retryCount ?? 0) >= MAX_TRANSIENT_SETUP_RESUME_DELAY_MS) {
      signals.push('setup_fetch_max_backoff')
    }
    if (input.hold.code === 'CLAUDE_TIMEOUT' && (input.hold.retryCount ?? 0) >= 3) {
      signals.push(`claude_timeout_repeated:${input.hold.retryCount}`)
    }
    if (input.hold.code === 'CLAUDE_TIMEOUT' && claudeTimeoutResumeDelayMs(input.hold.retryCount ?? 0) >= MAX_TRANSIENT_CLAUDE_TIMEOUT_RESUME_DELAY_MS) {
      signals.push('claude_timeout_max_backoff')
    }
  }
  if (input.productivePaths.length === 0) {
    signals.push('no_productive_paths')
  }
  if (repetition.sameProductivePathStreak >= 3) {
    signals.push(`repeated_productive_paths:${repetition.sameProductivePathStreak}`)
  }
  const testCount = repetition.categoryCounts.test ?? 0
  const sourceCount = repetition.categoryCounts.source ?? 0
  if (testCount >= 4 && sourceCount === 0 && Object.keys(repetition.categoryCounts).length === 1) {
    signals.push('test_only_window')
  }
  if (testCount >= 4 && testCount >= Math.max(1, sourceCount) * 2) {
    signals.push('test_heavy_window')
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

export function nonInteractiveGitEnv(): NodeJS.ProcessEnv {
  return {
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    GIT_TERMINAL_PROMPT: '0',
  }
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

function worktreeFetchTimeoutMs(config: Pick<AutoflowConfig, 'commandTimeoutMs'> & Partial<Pick<AutoflowConfig, 'worktreeFetchTimeoutMs'>>): number {
  const configured = typeof config.worktreeFetchTimeoutMs === 'number' && Number.isFinite(config.worktreeFetchTimeoutMs)
    ? config.worktreeFetchTimeoutMs
    : WORKTREE_FETCH_TIMEOUT_MS
  return Math.min(config.commandTimeoutMs, configured)
}

function setupFetchAttempts(config: Partial<Pick<AutoflowConfig, 'setupFetchAttempts'>>): number {
  const attempts = Math.floor(config.setupFetchAttempts ?? 1)
  return Number.isFinite(attempts) && attempts > 0 ? attempts : 1
}

function readLaunchdRegistration(label: string, env: NodeJS.ProcessEnv = process.env): LaunchdRegistration {
  const home = env['HOME'] ?? homedir()
  const plistPath = join(home, 'Library', 'LaunchAgents', `${label}.plist`)
  if (!existsSync(plistPath)) {
    return { label, plistPath, exists: false, environment: {}, programArguments: [], runtime: readLaunchdRuntime(label, env) }
  }
  const plist = readFileSync(plistPath, 'utf8')
  return {
    label,
    plistPath,
    exists: true,
    environment: readPlistStringDict(plist, 'EnvironmentVariables'),
    startInterval: readPlistInteger(plist, 'StartInterval'),
    workingDirectory: readPlistString(plist, 'WorkingDirectory'),
    programArguments: readPlistStringArray(plist, 'ProgramArguments'),
    runtime: readLaunchdRuntime(label, env),
  }
}

function readLaunchdRuntime(label: string, env: NodeJS.ProcessEnv = process.env): LaunchdRuntimeStatus | undefined {
  if (env['AEDEV_AUTOFLOW_SKIP_LAUNCHD_RUNTIME'] === '1') return undefined
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  if (uid === undefined) {
    return { checked: false, loaded: false, reason: 'launchd runtime check is only available on uid-aware platforms' }
  }
  const target = `gui/${uid}/${label}`
  const result = spawnSync('launchctl', ['print', target], { encoding: 'utf8' })
  return parseLaunchdRuntimeOutput(label, result.status ?? 1, result.stdout ?? '', result.stderr ?? '')
}

export function parseLaunchdRuntimeOutput(label: string, exitCode: number, stdout: string, stderr = ''): LaunchdRuntimeStatus {
  if (exitCode !== 0) {
    return {
      checked: true,
      loaded: false,
      reason: summarizeCommandOutput(stderr) ?? `launchd label is not loaded: ${label}`,
    }
  }
  return {
    checked: true,
    loaded: true,
    state: firstLaunchdString(stdout, /state = ([^\n]+)/),
    runs: firstLaunchdNumber(stdout, /runs = ([0-9]+)/),
    lastExitCode: firstLaunchdNumber(stdout, /last exit code = (-?[0-9]+)/),
    pid: firstLaunchdNumber(stdout, /pid = ([0-9]+)/),
  }
}

function firstLaunchdString(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern)
  return match?.[1]?.trim()
}

function firstLaunchdNumber(output: string, pattern: RegExp): number | undefined {
  const value = firstLaunchdString(output, pattern)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function buildSoakStatus(
  config: Pick<AutoflowConfig, 'logPath' | 'evidenceDir'>,
  state: AutoflowDoctorReport['state'],
  summary: AutoflowDoctorReport['summary'],
  now: Date,
): AutoflowSoakStatus {
  const events = readAutoflowLogEvents(config.logPath)
  const completedCycles = sortedUnique(events
    .filter((event) => event.type === 'autoflow.cycle_completed')
    .map((event) => event.cycle)
    .filter(isFiniteNumber))
  const latestCliStarted = lastEventOfType(events, 'autoflow.cli_started')
  const latestHeartbeat = lastEventOfType(events, 'autoflow.stage_heartbeat')
  const latestCompleted = lastEventOfType(events, 'autoflow.cycle_completed')
  const usageFromEvidence = readUsageTotalsFromEvidence(config.evidenceDir)
  const usage = usageFromEvidence.cyclesWithUsage > 0
    ? usageFromEvidence.total
    : summary?.usage?.total ?? emptyUsageTotal()
  const latestHeartbeatMs = latestHeartbeat ? Date.parse(latestHeartbeat.ts) : undefined
  const runStartedMs = latestCliStarted ? Date.parse(latestCliStarted.ts) : undefined

  const notes: string[] = []
  if (usageFromEvidence.cyclesWithUsage === 0 && summary?.usage) notes.push('usage fell back to latest summary because no cycle model-usage files were found')
  if (!latestHeartbeat) notes.push('no stage heartbeat has been logged yet')
  if (state?.status === 'running' && !latestCliStarted) notes.push('state is running but no cli_started event was found')

  return {
    checked: true,
    active: state?.status === 'running',
    runStartedAt: latestCliStarted?.ts,
    runAgeMs: runStartedMs !== undefined && Number.isFinite(runStartedMs) ? Math.max(0, now.getTime() - runStartedMs) : undefined,
    latestHeartbeatAt: latestHeartbeat?.ts,
    latestHeartbeatAgeMs: latestHeartbeatMs !== undefined && Number.isFinite(latestHeartbeatMs) ? Math.max(0, now.getTime() - latestHeartbeatMs) : undefined,
    currentCycle: state?.currentCycle ?? (isFiniteNumber(latestHeartbeat?.cycle) ? latestHeartbeat?.cycle : undefined),
    completedCycles,
    completedCycleCount: completedCycles.length,
    latestCompletedCycle: completedCycles[completedCycles.length - 1],
    lastCompletedAt: latestCompleted?.ts ?? state?.lastCompletedAt,
    holdCount: events.filter((event) => event.type === 'autoflow.hold').length,
    autoResumeCount: events.filter((event) => event.type === 'autoflow.hold_auto_resumed').length,
    claudeStartedCount: events.filter((event) => event.type === 'autoflow.claude_started').length,
    coderStartedCount: events.filter((event) => event.type === 'autoflow.coder_started').length,
    cyclesWithUsage: usageFromEvidence.cyclesWithUsage || (summary?.usage ? 1 : 0),
    usage,
    notes,
  }
}

interface AutoflowLogEvent {
  ts: string
  type?: string
  cycle?: unknown
  [key: string]: unknown
}

function readAutoflowLogEvents(logPath: string): AutoflowLogEvent[] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as AutoflowLogEvent
      } catch {
        return undefined
      }
    })
    .filter((event): event is AutoflowLogEvent => !!event && typeof event.ts === 'string')
}

function lastEventOfType(events: AutoflowLogEvent[], type: string): AutoflowLogEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === type) return events[index]
  }
  return undefined
}

function readUsageTotalsFromEvidence(evidenceDir: string): { cyclesWithUsage: number; total: AutoflowUsageSummary['total'] } {
  const total = emptyUsageTotal()
  if (!existsSync(evidenceDir)) return { cyclesWithUsage: 0, total }
  let cyclesWithUsage = 0
  for (const entry of readdirSync(evidenceDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^cycle-\d{6}$/.test(entry.name)) continue
    const usagePath = join(evidenceDir, entry.name, 'model-usage.json')
    if (!existsSync(usagePath)) continue
    try {
      const parsed = JSON.parse(readFileSync(usagePath, 'utf8')) as Partial<AutoflowUsageSummary>
      if (!parsed.total) continue
      cyclesWithUsage++
      addUsageTotal(total, parsed.total)
    } catch {
      // Ignore malformed historical evidence and keep doctor read-only.
    }
  }
  return { cyclesWithUsage, total }
}

function emptyUsageTotal(): AutoflowUsageSummary['total'] {
  return {
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }
}

function addUsageTotal(target: AutoflowUsageSummary['total'], next: AutoflowUsageSummary['total']): void {
  target.inputTokens += next.inputTokens
  target.outputTokens += next.outputTokens
  target.cacheCreationInputTokens += next.cacheCreationInputTokens
  target.cacheReadInputTokens += next.cacheReadInputTokens
  if (typeof next.costUsd === 'number') target.costUsd = (target.costUsd ?? 0) + next.costUsd
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function buildCadenceStatus(
  launchd: LaunchdRegistration | undefined,
  state: AutoflowDoctorReport['state'],
  now: Date,
): AutoflowCadenceStatus | undefined {
  if (!launchd?.startInterval) return undefined
  if (!state?.lastCompletedAt) {
    return {
      checked: false,
      intervalSeconds: launchd.startInterval,
      overdue: false,
      reason: 'no completed cycle has been recorded yet',
    }
  }

  const completedMs = Date.parse(state.lastCompletedAt)
  if (!Number.isFinite(completedMs)) {
    return {
      checked: false,
      intervalSeconds: launchd.startInterval,
      lastCompletedAt: state.lastCompletedAt,
      overdue: false,
      reason: 'lastCompletedAt is not parseable',
    }
  }

  const intervalMs = launchd.startInterval * 1000
  const graceMs = intervalMs * 2
  const dueMs = completedMs + graceMs
  const overdueMs = now.getTime() - dueMs
  return {
    checked: true,
    intervalSeconds: launchd.startInterval,
    lastCompletedAt: state.lastCompletedAt,
    nextExpectedAt: new Date(completedMs + intervalMs).toISOString(),
    graceSeconds: graceMs / 1000,
    overdue: overdueMs > 0,
    overdueMs: overdueMs > 0 ? overdueMs : 0,
    reason: overdueMs > 0
      ? `no completed cycle within ${graceMs / 1000}s of last completion`
      : undefined,
  }
}

function buildOperatorAction(
  config: AutoflowConfig,
  launchd: LaunchdRegistration | undefined,
  state: AutoflowDoctorReport['state'],
  summary: AutoflowDoctorReport['summary'],
  cadence: AutoflowCadenceStatus | undefined,
  checks: AutoflowDoctorReport['checks'],
  soak?: AutoflowSoakStatus,
): AutoflowOperatorAction {
  if (launchd && !launchd.exists) {
    return {
      severity: 'fail',
      summary: 'Autoflow launchd plist is missing; reinstall or register the loop.',
      details: [`Expected plist: ${launchd.plistPath}`],
    }
  }

  if (launchd?.runtime && !launchd.runtime.loaded) {
    return {
      severity: 'warn',
      summary: 'Autoflow launchd label is not loaded.',
      command: launchd.exists ? `launchctl bootstrap gui/$(id -u) ${shellArg(launchd.plistPath)}` : undefined,
      details: [launchd.runtime.reason ?? `Label: ${launchd.label}`],
    }
  }

  if (state?.status === 'hold' && state.hold) {
    return {
      severity: 'warn',
      summary: `Autoflow is on HOLD: ${state.hold.code}.`,
      details: [
        state.hold.operatorHint ?? state.hold.reason,
        `Evidence directory: ${config.evidenceDir}`,
      ],
    }
  }

  if (checks.some((check) => check.code === 'running_state_stale' && check.status === 'warn')) {
    return {
      severity: 'warn',
      summary: 'Autoflow has a stale running state; the next run should recover it.',
      details: [
        `State path: ${config.statePath}`,
        `Log path: ${config.logPath}`,
      ],
    }
  }

  if (state?.status === 'running') {
    return {
      severity: 'info',
      summary: `Autoflow cycle ${state.currentCycle ?? state.nextCycle} is currently running.`,
      details: [
        ...(state.lastStartedAt ? [`Started at: ${state.lastStartedAt}`] : []),
        ...(soak?.runAgeMs !== undefined ? [`Current run age: ${soak.runAgeMs}ms`] : []),
        ...(soak?.latestHeartbeatAt ? [`Latest heartbeat: ${soak.latestHeartbeatAt}`] : []),
        ...(soak?.usage ? [`Observed Claude output/cache tokens: ${soak.usage.outputTokens}/${soak.usage.cacheReadInputTokens}`] : []),
        ...(launchd?.runtime?.pid ? [`launchd pid: ${launchd.runtime.pid}`] : []),
        `Log path: ${config.logPath}`,
      ],
    }
  }

  if (cadence?.checked && cadence.overdue && launchd?.label) {
    return {
      severity: 'warn',
      summary: 'Autoflow launchd cadence is overdue; kickstart the label or inspect launchd.',
      command: `launchctl kickstart -k gui/$(id -u)/${launchd.label}`,
      details: cadence.reason ? [cadence.reason] : undefined,
    }
  }

  const failedGates = summary?.gates.filter((gate) => gate.exitCode !== 0) ?? []
  if (failedGates.length > 0) {
    return {
      severity: 'warn',
      summary: 'Latest Autoflow summary has failing gates; inspect evidence before the next run.',
      details: failedGates.map((gate) => `${gate.command} exited ${gate.exitCode}`),
    }
  }

  const firstFail = checks.find((check) => check.status === 'fail')
  if (firstFail) {
    return {
      severity: 'fail',
      summary: firstFail.message,
    }
  }

  const firstWarn = checks.find((check) => check.status === 'warn')
  if (firstWarn) {
    return {
      severity: 'warn',
      summary: firstWarn.message,
    }
  }

  return {
    severity: 'info',
    summary: 'Autoflow is healthy; wait for the next scheduled run.',
    details: cadence?.nextExpectedAt ? [`Next expected run: ${cadence.nextExpectedAt}`] : undefined,
  }
}

function launchdAutoflowArgv(programArguments: string[]): string[] {
  const index = programArguments.findIndex((arg) => arg.endsWith('autoflow-loop.ts'))
  return index >= 0 ? programArguments.slice(index + 1) : []
}

function shellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function readPlistStringDict(plist: string, key: string): NodeJS.ProcessEnv {
  const body = readPlistBlock(plist, key, 'dict')
  if (!body) return {}
  const result: NodeJS.ProcessEnv = {}
  const pairPattern = /<key>([^<]+)<\/key>\s*<string>([\s\S]*?)<\/string>/g
  for (const match of body.matchAll(pairPattern)) {
    result[decodePlistValue(match[1])] = decodePlistValue(match[2])
  }
  return result
}

function readPlistStringArray(plist: string, key: string): string[] {
  const body = readPlistBlock(plist, key, 'array')
  if (!body) return []
  return [...body.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => decodePlistValue(match[1]))
}

function readPlistString(plist: string, key: string): string | undefined {
  const match = plist.match(new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>([\\s\\S]*?)</string>`))
  return match ? decodePlistValue(match[1]) : undefined
}

function readPlistInteger(plist: string, key: string): number | undefined {
  const match = plist.match(new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<integer>([0-9]+)</integer>`))
  return match ? Number(match[1]) : undefined
}

function readPlistBlock(plist: string, key: string, tag: 'dict' | 'array'): string | undefined {
  const match = plist.match(new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<${tag}>([\\s\\S]*?)</${tag}>`))
  return match?.[1]
}

function decodePlistValue(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function pathStatus(path: string): { path: string; exists: boolean } {
  return { path, exists: existsSync(path) }
}

function pickDoctorState(state: AutoflowState): AutoflowDoctorState {
  return {
    status: state.status,
    nextCycle: state.nextCycle,
    currentCycle: state.currentCycle,
    branch: state.branch,
    worktreePath: state.worktreePath,
    lastStartedAt: state.lastStartedAt,
    lastCompletedAt: state.lastCompletedAt,
    lastCommitSha: state.lastCommitSha,
    hold: state.hold,
  }
}

function pickDoctorSummary(summary: AutoflowSummary): AutoflowDoctorSummary {
  return {
    status: summary.status,
    cycle: summary.cycle,
    nextCycle: summary.nextCycle,
    coderProvider: summary.coderProvider,
    updatedAt: summary.updatedAt,
    commitSha: summary.commitSha,
    plannerSignals: summary.plannerSignals,
    changedPaths: summary.changedPaths,
    gates: summary.gates,
    usage: summary.usage,
  }
}

function isRunningStateStaleAt(
  config: Pick<AutoflowConfig, 'commandTimeoutMs' | 'logPath' | 'runningStateTtlMs' | 'stageHeartbeatIntervalMs'>,
  state: Pick<AutoflowState, 'currentCycle' | 'lastStartedAt' | 'nextCycle'>,
  now: Date,
): boolean {
  if (!state.lastStartedAt) return true
  const startedMs = Date.parse(state.lastStartedAt)
  if (!Number.isFinite(startedMs)) return true
  const ageMs = now.getTime() - startedMs
  if (ageMs > config.runningStateTtlMs) return true

  const cycle = state.currentCycle ?? state.nextCycle
  const heartbeat = latestStageHeartbeatForCycle(config.logPath, cycle)
  const heartbeatMs = heartbeat ? Date.parse(heartbeat.ts) : undefined
  if (heartbeatMs !== undefined && Number.isFinite(heartbeatMs)) {
    return now.getTime() - heartbeatMs > config.stageHeartbeatIntervalMs * 3
  }

  const setupGraceMs = Math.max(config.commandTimeoutMs * 2, config.stageHeartbeatIntervalMs * 3, 60_000)
  return ageMs > setupGraceMs
}

function latestStageHeartbeatForCycle(logPath: string, cycle: number | undefined): AutoflowLogEvent | undefined {
  if (!cycle) return undefined
  const events = readAutoflowLogEvents(logPath)
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'autoflow.stage_heartbeat' && event.cycle === cycle) return event
  }
  return undefined
}

function overallDoctorStatus(checks: AutoflowDoctorReport['checks']): AutoflowDoctorReport['status'] {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  if (checks.some((check) => check.status === 'warn')) return 'warn'
  return 'pass'
}

function summarizeCommandOutput(output: string, maxLength = 500): string | undefined {
  const trimmed = output.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseList(raw: string | undefined, fallback: string[] = []): string[] {
  if (!raw) return [...fallback]
  return raw.split('||').map((item) => item.trim()).filter(Boolean)
}

function parseMaxCycles(raw: string | undefined): number | null {
  if (!raw || raw === 'infinite' || raw === 'continuous') return null
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

function parseCoderProvider(raw: string | undefined): CoderProvider {
  if (raw === 'claude') return 'claude'
  return 'codex'
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
