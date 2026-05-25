/** Typed errors for the aedev system. */

/**
 * Thrown by an aedev adapter that exists in the codebase but is not configured
 * for the current runtime (e.g. an optional adapter selected by feature flag
 * or runner mode that is not enabled).  Callers can use
 * `instanceof ExperimentalFeatureError` to distinguish "optional adapter not
 * configured" from a generic runtime failure.
 *
 * Per ADR-0009, this error must not appear on a configured happy path.  The
 * default `DockerRunner` and `ClaudeCodeAdapter` paths are real implementations
 * and never throw this error.
 */
export class ExperimentalFeatureError extends Error {
  readonly feature: string

  constructor(feature: string, detail?: string) {
    const msg = detail
      ? `[aedev] ${feature} is not configured: ${detail}`
      : `[aedev] ${feature} is not configured`
    super(msg)
    this.name = 'ExperimentalFeatureError'
    this.feature = feature
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) Error.captureStackTrace(this, ExperimentalFeatureError)
  }
}
