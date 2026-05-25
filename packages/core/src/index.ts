/** Core shared types and utilities for the aedev system. */

export const VERSION = '0.0.1' as const

/** Unique identifier (ULID format). */
export type Id = string

/** ISO-8601 UTC timestamp string. */
export type Timestamp = string

/** Status of an individual task through its lifecycle. */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'hold'

/** Status of a mission (collection of tasks). */
export type MissionStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'paused'

/** Risk classification for a task or mission. */
export type RiskLevel = 'low' | 'medium' | 'high'

/** Risk score range (0 = no risk, 100 = maximum risk). */
export type RiskScore = number
