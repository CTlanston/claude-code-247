import type { RiskLevel } from '@aedev/core'

export interface RiskFactors {
  touchesForbiddenPaths: boolean   // +50
  diffLinesChanged: number          // +20 if > 500
  hasDependencyChanges: boolean     // +15
  testCoverageDecreased: boolean    // +15
  usesSecrets: boolean              // +20
  hasMigrationChanges: boolean      // +20
  hasControlPlaneChanges: boolean   // +30
}

export interface RiskScoreResult {
  score: number
  level: RiskLevel
  breakdown: Record<keyof RiskFactors, number>
}

export class RiskScorer {
  static compute(factors: RiskFactors): RiskScoreResult {
    const breakdown: Record<keyof RiskFactors, number> = {
      touchesForbiddenPaths: factors.touchesForbiddenPaths ? 50 : 0,
      diffLinesChanged: factors.diffLinesChanged > 500 ? 20 : 0,
      hasDependencyChanges: factors.hasDependencyChanges ? 15 : 0,
      testCoverageDecreased: factors.testCoverageDecreased ? 15 : 0,
      usesSecrets: factors.usesSecrets ? 20 : 0,
      hasMigrationChanges: factors.hasMigrationChanges ? 20 : 0,
      hasControlPlaneChanges: factors.hasControlPlaneChanges ? 30 : 0,
    }
    const raw = Object.values(breakdown).reduce((a, b) => a + b, 0)
    const score = Math.min(raw, 100)
    const level: RiskLevel = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low'
    return { score, level, breakdown }
  }
}
