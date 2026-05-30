export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'hold'
export type MissionStatus = 'draft' | 'pending_approval' | 'approved' | 'running' | 'done' | 'failed' | 'cancelled' | 'paused'
export type RunStatus = 'pending' | 'running' | 'done' | 'failed'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type SecretGrantStatus = 'active' | 'expired' | 'revoked'
export type RunnerMode =
  | 'claude-docker'
  | 'docker'
  | 'local'
  | 'mock'
  | 'claude247-bridge'
  | 'claude-cli'
  | 'codex-cli'
  | 'subscription-pool'
export type RiskLevel = 'low' | 'medium' | 'high'
export type ValidatorName = 'gemini' | 'openai' | 'codex' | 'mock'
export type ValidatorVerdict = 'pass' | 'fail' | 'inconclusive'
export type MergePolicyDecision = 'AUTO_MERGE' | 'WAITING' | 'BLOCKED'

export interface Repo {
  id: string
  name: string
  path: string
  githubOwner?: string
  githubRepo?: string
  defaultBranch: string
  enabled: boolean
  testCommands: string[]
  forbiddenPaths: string[]
  riskRules: Record<string, unknown>
  mergePolicy: string
  createdAt: string
  updatedAt: string
}

export interface Roadmap {
  id: string
  repoId?: string
  title: string
  description?: string
  status: string
  prdPath?: string
  createdAt: string
  updatedAt: string
}

export interface Mission {
  id: string
  roadmapId?: string
  repoId: string
  title: string
  description?: string
  status: MissionStatus
  riskLevel?: RiskLevel
  prdPath?: string
  githubBranch?: string
  githubPrUrl?: string
  githubPrNumber?: number
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  missionId: string
  repoId: string
  title: string
  prompt: string
  status: TaskStatus
  attemptNumber: number
  parentTaskId?: string
  createdAt: string
  updatedAt: string
}

export interface Run {
  id: string
  taskId: string
  runnerMode: RunnerMode
  status: RunStatus
  startedAt?: string
  completedAt?: string
  exitCode?: number
  evidenceDir?: string
  errorMessage?: string
  createdAt: string
}

export interface Approval {
  id: string
  entityType: string
  entityId: string
  requiredReason: string
  status: ApprovalStatus
  decidedBy?: string
  decidedAt?: string
  notes?: string
  createdAt: string
}

export interface RiskScore {
  id: string
  taskId: string
  runId?: string
  score: number
  level: RiskLevel
  factors: Record<string, number>
  computedAt: string
}

export interface ValidatorResult {
  id: string
  taskId: string
  runId: string
  validator: ValidatorName
  verdict: ValidatorVerdict
  summary?: string
  evidenceBundlePath?: string
  createdAt: string
}

export interface ModelUsage {
  id: string
  taskId?: string
  runId?: string
  authMode: string
  model?: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  notes?: string
  createdAt: string
}

export interface MemoryItem {
  id: string
  type: string
  title: string
  content: string
  sourceTaskId?: string
  sourceMissionId?: string
  repoId?: string
  approved: boolean
  createdAt: string
}

export interface OperatorSession {
  id: string
  repoId?: string
  missionId?: string
  title: string
  prompt: string
  status: string
  createdAt: string
  updatedAt: string
}

export type OperatorChoiceAction = 'generate-roadmap' | 'ask-questions' | 'add-constraints'

export interface OperatorChoice {
  id: string
  label: string
  labelEn: string
  action: OperatorChoiceAction
  prompt?: string
}

export interface OperatorMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  choices?: OperatorChoice[]
  createdAt: string
}

export interface MissionArtifact {
  id: string
  missionId: string
  type: 'prd' | 'adr' | 'roadmap' | 'evidence' | 'report' | 'other'
  path: string
  title?: string
  createdAt: string
  updatedAt: string
}

export interface SecretGrant {
  id: string
  secretName: string
  taskId: string
  ttlSeconds: number
  grantedBy: string
  grantedAt: string
  expiresAt: string
  reason: string
  status: SecretGrantStatus
  revokedAt?: string
  revokeReason?: string
}

export interface Event {
  id: string
  type: string
  entityType?: string
  entityId?: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface RunnerConfig {
  mode: RunnerMode
  maxConcurrentWorkers: number
  worktreeBaseDir: string
  outputBaseDir: string
  /**
   * Optional source checkout to copy/clone into the per-task worktree before a
   * local CLI worker runs.  Used by V2.4 vertical slices so the worker edits a
   * safe repo copy instead of an empty scratch directory.
   */
  sourceRepoPath?: string
  testCommands?: string[]
  forbiddenPaths?: string[]
  createLocalCommit?: boolean
  branchPrefix?: string
}

export interface RunResult {
  runId: string
  taskId: string
  exitCode: number
  evidenceDir: string
  durationMs: number
}
