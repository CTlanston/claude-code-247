/** aedev daemon entry point. */

export const DAEMON_NAME = 'aedev-daemon' as const

/** Default port for the Fastify daemon API. */
export const DEFAULT_PORT = 7247 as const

/** Daemon lifecycle states. */
export type DaemonState = 'starting' | 'running' | 'stopping' | 'stopped'

export { Daemon } from './daemon.js'
export { createServer } from './server.js'
export { HeartbeatService } from './heartbeat.js'
export { IntakeService } from './intake.js'
export { DailySummaryGenerator } from './daily-summary.js'
export type { DailySummaryOptions, DailySummaryStats } from './daily-summary.js'
export { AutonomousIntakeService } from './autonomous-intake.js'
export type {
  AutonomousIntakeScanOptions,
  AutonomousIntakeScanResult,
  AutonomousIntakeServiceOptions,
  MaterializedIntakeMission,
} from './autonomous-intake.js'
export { ReleasePipeline } from './release-pipeline.js'
export { ChildProcessGitClient } from '@aedev/runner'
export { PremiumDebugger, buildFailureSignature } from './premium-debugger.js'
export { MissionScheduler } from './mission-scheduler.js'
export { planDocFollowup } from './doc-followup.js'
export type { DocFollowupInput, DocFollowupPlan } from './doc-followup.js'
export {
  DraftPrGate,
  DraftPrGateError,
  draftPrIdempotencyKey,
  renderDraftPrBody,
} from './draft-pr-gate.js'
export type {
  DraftPrCreator,
  DraftPrGateConfig,
  DraftPrInfo,
  DraftPrRequest,
  GitRemoteWriter,
} from './draft-pr-gate.js'
export {
  BoundedMoveRunner,
  moveIdempotencyKey,
} from './moves/index.js'
export type {
  BoundedMove,
  MoveRunnerOpts,
  MoveRunResult,
} from './moves/index.js'
export {
  classifyIntakeBatch,
  classifyIntakeCandidate,
  MissionIntakeSource,
  scanFailingTestCandidates,
  scanGitHubIssueCandidates,
  scanTodoCandidates,
} from './mission-intake-source.js'
export type {
  ClassifiedIntakeCandidate,
  FailingTestScannerOptions,
  GitHubIssueScannerOptions,
  IntakeBatchResult,
  IntakeCandidate,
  IntakeDecision,
  MissionIntakeScanResult,
  MissionIntakeSourceOptions,
  IntakeSourceKind,
  TodoScannerOptions,
} from './mission-intake-source.js'
export type {
  ScheduledMission,
  SchedulerOptions,
  DispatchFn,
} from './mission-scheduler.js'
export { InterruptionPolicy } from './interruption-policy.js'
export type {
  InterruptionReason,
  InterruptionUrgency,
  InterruptionRequest,
  PolicySnapshot,
  InterruptionPolicyOptions,
} from './interruption-policy.js'
export { ProductMemory } from './product-memory.js'
export { MissionRunner, MemoryGitClient, previewAdapterAsDeployFn } from './mission-runner.js'
export type { MissionRunOptions, MissionRunResult, MissionValidator } from './mission-runner.js'
export type { ProductMemoryCategory, RecordOptions } from './product-memory.js'
export type {
  PremiumDebuggerOptions,
  PremiumDebugContext,
  PremiumDebugInput,
  PremiumDebugResponse,
  PremiumDebugResult,
  PremiumDebuggerFn,
  RepairAttempt,
  CircuitBreakerResult,
} from './premium-debugger.js'
export type {
  GitClient,
  DeployRequest,
  DeployResult,
  DeployFn,
  HealthcheckOptions,
  ReleasePipelineOptions,
  ReleaseRequest,
  ReleaseResult,
} from './release-pipeline.js'
export {
  RolePipeline,
  ArchitectRole,
  DesignerRole,
  BuilderRole,
  QARole,
  ReviewerRole,
  ReleaseRole,
} from './roles/index.js'
export type {
  Role,
  RoleContext,
  RoleOutput,
  BuilderTaskSpec,
  RolePipelineOptions,
  RolePipelineRunResult,
} from './roles/index.js'
