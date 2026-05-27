/** Stage M1 — CLI canary harness.
 *
 * Detects subscription CLI version drift. The expectation is that
 * `claude --version` (or `claude --print '{}'`) returns a known
 * fingerprint; if it changes, the canary opens a HOLD and refuses to
 * upgrade auto-installed dependents on the new version.
 */

export interface CanaryFingerprint {
  cliVersion: string
  outputShape: string
}

export interface CanaryResult {
  baseline: CanaryFingerprint
  observed: CanaryFingerprint
  matches: boolean
  diff?: Array<{ field: keyof CanaryFingerprint; baseline: string; observed: string }>
}

export function compareCanary(baseline: CanaryFingerprint, observed: CanaryFingerprint): CanaryResult {
  const diff: NonNullable<CanaryResult['diff']> = []
  for (const k of ['cliVersion', 'outputShape'] as const) {
    if (baseline[k] !== observed[k]) diff.push({ field: k, baseline: baseline[k], observed: observed[k] })
  }
  return { baseline, observed, matches: diff.length === 0, diff: diff.length ? diff : undefined }
}
