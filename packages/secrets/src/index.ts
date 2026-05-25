/** Secret grant manager — TTL-based, audited, per-task secret access. */

/** Status of a secret grant. */
export type SecretGrantStatus = 'active' | 'expired' | 'revoked'

/** A time-limited secret grant for a specific task. */
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
}
