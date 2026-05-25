/** Typed errors for the aedev system. */

/**
 * Thrown by any TypeScript aedev component that is a recognised placeholder —
 * i.e. the component exists in the prototype but its real implementation has
 * not been completed yet.  Callers can use `instanceof ExperimentalFeatureError`
 * to distinguish "not implemented in prototype" from general runtime failures.
 */
export class ExperimentalFeatureError extends Error {
  readonly feature: string

  constructor(feature: string, detail?: string) {
    const msg = detail
      ? `[aedev prototype] ${feature} is not yet implemented: ${detail}`
      : `[aedev prototype] ${feature} is not yet implemented`
    super(msg)
    this.name = 'ExperimentalFeatureError'
    this.feature = feature
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) Error.captureStackTrace(this, ExperimentalFeatureError)
  }
}
