/** Worker runner for isolated task execution. */

// Re-export core types for backward compatibility
export type { RunnerMode, RunnerConfig, RunResult } from '@aedev/core'

export { EvidenceWriter } from './evidence.js'
export { MockRunner } from './mock-runner.js'
export { DockerRunner } from './docker-runner.js'
export { ClaudeDockerRunner, preflightClaudeDockerEnvironment } from './claude-docker-runner.js'
export { WorktreeManager } from './worktree.js'
export {
  TARGET_REPO_HOLD,
  TargetRepoUnavailableError,
  validateTargetRepo,
  createRepoBoundWorkspace,
  removeRepoBoundWorkspace,
  collectWorkspaceDiff,
  pathMatches,
} from './operator-workspace.js'
export type { GitExec, RepoPreflight, RepoBoundWorkspace, WorkspaceDiff } from './operator-workspace.js'
export { ClaudeCodeAdapter } from './claude-adapter.js'
export { CodexCliAdapter } from './codex-adapter.js'
export { LocalCliRunner } from './cli-runner.js'
export { FleetWorkerAgent, scrubCredentialFields } from './fleet-worker.js'
export type {
  FleetExecutor,
  FleetExecutorResult,
  FleetFetchFn,
  FleetFetchResponse,
  FleetLoopResult,
  FleetRegisterResult,
  FleetRunLoopOptions,
  FleetRunOnceResult,
  FleetWorkerAgentOptions,
  FleetWorkerClock,
} from './fleet-worker.js'
export { WorkerPoolRouter, dynamicConcurrency } from './worker-pool-router.js'
export { discoverWorkerSessions } from './worker-session-discovery.js'
export type {
  ClaudeAdapterOptions,
  ClaudeAuthMode,
  ClaudeRunOptions,
  ClaudeRunResult,
} from './claude-adapter.js'
export type {
  CodexAdapterOptions,
  CodexRunOptions,
  CodexRunResult,
} from './codex-adapter.js'
export type {
  LocalCliKind,
} from './cli-runner.js'
export type {
  ModelFamily,
  ProviderId,
  RouteDecision,
  RouteRequest,
  WorkerSession,
} from './worker-pool-router.js'
export type { DiscoverWorkerSessionsOptions } from './worker-session-discovery.js'
export type { DockerRunnerOptions } from './docker-runner.js'
export type {
  ClaudeDockerCredential,
  ClaudeDockerHoldCode,
  ClaudeDockerPreflightIssue,
  ClaudeDockerPreflightOptions,
  ClaudeDockerPreflightResult,
  ClaudeDockerRuntimePreflightResult,
  ClaudeDockerRunnerOptions,
  DockerExecRequest,
  DockerExecResult,
} from './claude-docker-runner.js'
export { RunnerManager } from './runner-manager.js'
export type { RunnerInterface } from './runner-interface.js'
export { ChildProcessGitClient } from './git-client.js'
export type { GitClient } from './git-client.js'
export { GhGitRemoteWriter, GhDraftPrCreator, defaultExec } from './remote-write-gh.js'
export type { ExecFn, ExecResult, DraftPrInfo } from './remote-write-gh.js'
