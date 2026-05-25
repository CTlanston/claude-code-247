import { describe, it, expect } from 'vitest'
import { RiskScorer } from './risk-scorer.js'

const noRisk = {
  touchesForbiddenPaths: false, diffLinesChanged: 0,
  hasDependencyChanges: false, testCoverageDecreased: false,
  usesSecrets: false, hasMigrationChanges: false, hasControlPlaneChanges: false,
}

describe('RiskScorer', () => {
  it('all-false factors → score 0, level low', () => {
    const r = RiskScorer.compute(noRisk)
    expect(r.score).toBe(0); expect(r.level).toBe('low')
  })

  it('forbidden paths → score 50, level medium', () => {
    const r = RiskScorer.compute({ ...noRisk, touchesForbiddenPaths: true })
    expect(r.score).toBe(50); expect(r.level).toBe('medium')
  })

  it('forbidden paths + control plane (50+30=80) → level high', () => {
    const r = RiskScorer.compute({ ...noRisk, touchesForbiddenPaths: true, hasControlPlaneChanges: true })
    expect(r.score).toBe(80); expect(r.level).toBe('high')
  })

  it('all factors maxes out at 100', () => {
    const r = RiskScorer.compute({
      touchesForbiddenPaths: true, diffLinesChanged: 1000,
      hasDependencyChanges: true, testCoverageDecreased: true,
      usesSecrets: true, hasMigrationChanges: true, hasControlPlaneChanges: true,
    })
    expect(r.score).toBe(100)
  })
})
