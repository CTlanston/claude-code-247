/**
 * Interruption policy for multi-day autonomy (Phase 10).  The daemon
 * ordinarily runs unattended and only wakes the user for events the
 * migration plan calls out:
 *
 *   secret grant request, repeated failure loop, high-risk release,
 *   production incident, missing credential, no available worker / auth,
 *   validator disagreement.
 *
 * This module is purely declarative — it converts a system snapshot into
 * an `InterruptionRequest` (or null) that the daemon's notification
 * layer can act on.
 */
export type InterruptionReason =
  | 'secret_grant_request'
  | 'repeated_failure'
  | 'high_risk_release'
  | 'production_incident'
  | 'missing_credential'
  | 'no_available_worker'
  | 'validator_disagreement'

export type InterruptionUrgency = 'low' | 'medium' | 'high' | 'critical'

export interface InterruptionRequest {
  reason: InterruptionReason
  urgency: InterruptionUrgency
  message: string
  context: Record<string, unknown>
}

export interface PolicySnapshot {
  pendingSecretGrants?: Array<{ secretName: string; taskId: string }>
  /** Per-task counter of consecutive failed repair attempts. */
  repairFailureStreaks?: Record<string, number>
  /** Missions awaiting a human approval for a high-risk release. */
  highRiskReleases?: Array<{ missionId: string; riskScore: number }>
  /** Currently open incidents (post-deploy revert events etc.). */
  openIncidents?: Array<{ missionId: string; mergeSha: string; cause?: string }>
  /** Names of credentials that the system tried to use but found missing. */
  missingCredentials?: string[]
  /** True iff every worker slot is occupied and the queue is non-empty. */
  workerSaturation?: { available: number; queueDepth: number }
  /** Validator disagreement events (gemini said pass, openai said fail, or vice versa). */
  validatorDisagreements?: Array<{ taskId: string; geminiVerdict: string; openaiVerdict: string }>
}

export interface InterruptionPolicyOptions {
  /** Streak length at which `repeated_failure` fires.  Default 5. */
  repairStreakThreshold?: number
  /** Risk threshold at which `high_risk_release` becomes critical (vs high).  Default 70. */
  highRiskCriticalScore?: number
}

export class InterruptionPolicy {
  private readonly opts: Required<InterruptionPolicyOptions>

  constructor(opts: InterruptionPolicyOptions = {}) {
    this.opts = {
      repairStreakThreshold: opts.repairStreakThreshold ?? 5,
      highRiskCriticalScore: opts.highRiskCriticalScore ?? 70,
    }
  }

  /** Return every interruption the snapshot warrants, sorted by urgency. */
  evaluate(snapshot: PolicySnapshot): InterruptionRequest[] {
    const out: InterruptionRequest[] = []

    for (const inc of snapshot.openIncidents ?? []) {
      out.push({
        reason: 'production_incident',
        urgency: 'critical',
        message: `Production incident on mission ${inc.missionId} (merge ${inc.mergeSha.slice(0, 8)})`,
        context: { ...inc },
      })
    }

    for (const m of snapshot.missingCredentials ?? []) {
      out.push({
        reason: 'missing_credential',
        urgency: 'high',
        message: `Credential not available: ${m}`,
        context: { credential: m },
      })
    }

    for (const sg of snapshot.pendingSecretGrants ?? []) {
      out.push({
        reason: 'secret_grant_request',
        urgency: 'high',
        message: `Secret grant requested: ${sg.secretName} (task ${sg.taskId})`,
        context: { ...sg },
      })
    }

    for (const hr of snapshot.highRiskReleases ?? []) {
      const urgency: InterruptionUrgency = hr.riskScore >= this.opts.highRiskCriticalScore ? 'critical' : 'high'
      out.push({
        reason: 'high_risk_release',
        urgency,
        message: `High-risk release awaiting approval — mission ${hr.missionId} (score ${hr.riskScore})`,
        context: { ...hr },
      })
    }

    for (const d of snapshot.validatorDisagreements ?? []) {
      out.push({
        reason: 'validator_disagreement',
        urgency: 'medium',
        message: `Validator disagreement on task ${d.taskId} — Gemini=${d.geminiVerdict}, OpenAI=${d.openaiVerdict}`,
        context: { ...d },
      })
    }

    for (const [taskId, streak] of Object.entries(snapshot.repairFailureStreaks ?? {})) {
      if (streak >= this.opts.repairStreakThreshold) {
        out.push({
          reason: 'repeated_failure',
          urgency: streak >= this.opts.repairStreakThreshold * 2 ? 'high' : 'medium',
          message: `Task ${taskId} has failed ${streak} consecutive repair attempts.`,
          context: { taskId, streak },
        })
      }
    }

    const sat = snapshot.workerSaturation
    if (sat && sat.available === 0 && sat.queueDepth > 0) {
      out.push({
        reason: 'no_available_worker',
        urgency: sat.queueDepth >= 10 ? 'high' : 'medium',
        message: `No worker slots available; ${sat.queueDepth} tasks queued.`,
        context: { ...sat },
      })
    }

    return out.sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency))
  }
}

function urgencyRank(u: InterruptionUrgency): number {
  switch (u) {
    case 'critical': return 3
    case 'high': return 2
    case 'medium': return 1
    case 'low': return 0
  }
}
