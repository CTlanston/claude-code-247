/**
 * External preview deployment contracts (Phase 7).
 *
 * Per the migration plan §preview, every preview provider — Cloudflare Pages
 * (default), Vercel, GitHub Pages (static-only) — implements the same
 * `PreviewAdapter` interface so the release pipeline can swap providers per
 * repo without changing call sites.
 *
 * Missing credentials never crash: providers return a `PreviewResult` whose
 * `requiresSecretGrant` field is true so the daemon can open an approval
 * request instead.
 */
export interface PreviewDeployRequest {
  /** Local build output directory (e.g. `dist/`, `out/`, `.next/`). */
  outputDir: string
  /** Stable handle for the deployment (e.g. `mission-001-aedev`). */
  projectName: string
  /** Optional human-readable name shown in the provider UI. */
  branchName?: string
  /** Optional explicit credential. If omitted, the adapter looks at env. */
  token?: string
}

export interface PreviewResult {
  /** Deployed URL, or null if `requiresSecretGrant` / `error` is set. */
  url: string | null
  /** Provider name (matches PreviewProvider). */
  provider: PreviewProvider
  /** ISO timestamp of completion (or attempt). */
  deployedAt: string
  /** True iff the adapter could not deploy because no token was available. */
  requiresSecretGrant: boolean
  /** The env var name the operator must supply via `aedev secrets grant`. */
  requiredSecretName?: string
  /** Provider-specific metadata (raw stdout, project id, ...). */
  meta: Record<string, unknown>
  /** Set when the adapter errored despite having a token. */
  error?: string
}

export type PreviewProvider = 'cloudflare-pages' | 'vercel' | 'github-pages'

export interface PreviewAdapter {
  readonly provider: PreviewProvider
  /** Returns true iff the provider CLI/SDK is available on the host. */
  isAvailable(): Promise<boolean>
  deploy(req: PreviewDeployRequest): Promise<PreviewResult>
}
