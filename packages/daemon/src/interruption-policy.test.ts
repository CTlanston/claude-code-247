import { describe, it, expect } from 'vitest'
import { InterruptionPolicy, type PolicySnapshot } from './interruption-policy.js'

describe('InterruptionPolicy', () => {
  it('returns no requests when the system is calm', () => {
    const p = new InterruptionPolicy()
    expect(p.evaluate({})).toEqual([])
  })

  it('production incident is critical and sorted first', () => {
    const p = new InterruptionPolicy()
    const snap: PolicySnapshot = {
      openIncidents: [{ missionId: 'm-1', mergeSha: 'abcdef0123', cause: 'healthcheck' }],
      pendingSecretGrants: [{ secretName: 'CF_TOKEN', taskId: 't-1' }],
    }
    const out = p.evaluate(snap)
    expect(out[0]?.reason).toBe('production_incident')
    expect(out[0]?.urgency).toBe('critical')
  })

  it('fires high_risk_release with critical urgency above the threshold', () => {
    const p = new InterruptionPolicy({ highRiskCriticalScore: 80 })
    const out = p.evaluate({ highRiskReleases: [{ missionId: 'm-h', riskScore: 90 }] })
    expect(out[0]?.reason).toBe('high_risk_release')
    expect(out[0]?.urgency).toBe('critical')
  })

  it('fires high_risk_release with high urgency below the critical threshold', () => {
    const p = new InterruptionPolicy({ highRiskCriticalScore: 80 })
    const out = p.evaluate({ highRiskReleases: [{ missionId: 'm-h', riskScore: 65 }] })
    expect(out[0]?.urgency).toBe('high')
  })

  it('fires repeated_failure once streak crosses threshold', () => {
    const p = new InterruptionPolicy({ repairStreakThreshold: 5 })
    const out = p.evaluate({ repairFailureStreaks: { 'task-A': 5, 'task-B': 3 } })
    expect(out).toHaveLength(1)
    expect(out[0]?.reason).toBe('repeated_failure')
    expect((out[0]?.context as { taskId?: string }).taskId).toBe('task-A')
  })

  it('fires no_available_worker only when queue is non-empty AND no slots free', () => {
    const p = new InterruptionPolicy()
    expect(p.evaluate({ workerSaturation: { available: 1, queueDepth: 10 } })).toEqual([])
    expect(p.evaluate({ workerSaturation: { available: 0, queueDepth: 0 } })).toEqual([])
    const out = p.evaluate({ workerSaturation: { available: 0, queueDepth: 12 } })
    expect(out[0]?.reason).toBe('no_available_worker')
    expect(out[0]?.urgency).toBe('high')  // queueDepth >= 10
  })

  it('fires validator_disagreement', () => {
    const p = new InterruptionPolicy()
    const out = p.evaluate({
      validatorDisagreements: [{ taskId: 't', geminiVerdict: 'pass', openaiVerdict: 'fail' }],
    })
    expect(out[0]?.reason).toBe('validator_disagreement')
    expect(out[0]?.urgency).toBe('medium')
  })

  it('sorts highest urgency first', () => {
    const p = new InterruptionPolicy()
    const out = p.evaluate({
      validatorDisagreements: [{ taskId: 't', geminiVerdict: 'pass', openaiVerdict: 'fail' }],
      openIncidents: [{ missionId: 'm', mergeSha: 'sha' }],
      missingCredentials: ['SOME_TOKEN'],
    })
    expect(out.map((r) => r.urgency)).toEqual(['critical', 'high', 'medium'])
  })
})
