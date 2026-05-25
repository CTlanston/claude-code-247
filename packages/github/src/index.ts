/** GitHub collaboration surface adapter. */

/** Identifies a GitHub repository. */
export interface GitHubRepo {
  owner: string
  repo: string
  defaultBranch: string
}

/** Status of a GitHub pull request. */
export type PrStatus = 'open' | 'closed' | 'merged' | 'draft'

/** A published GitHub check run result. */
export interface CheckResult {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'neutral' | 'skipped' | null
}
