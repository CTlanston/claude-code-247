import type { PreviewAdapter, PreviewDeployRequest, PreviewResult } from './preview-adapter.js'

/**
 * GitHub Pages adapter — static-only fallback.  Per the migration plan,
 * GitHub Pages is supported only for static sites and is NOT the
 * recommended path for full-stack previews.  This adapter is intentionally
 * minimal: it documents the static-only contract and returns a clear
 * "static only" marker.  Real publish-to-gh-pages is left to the user's
 * existing CI (e.g. peaceiris/actions-gh-pages).
 *
 * Per the GitHub docs, GitHub Pages publishes HTML/CSS/JS from a repo and
 * does not support server-side rendering or API routes.
 */
export class GitHubPagesAdapter implements PreviewAdapter {
  readonly provider = 'github-pages' as const

  async isAvailable(): Promise<boolean> {
    // GitHub Pages publish happens via repo CI; the adapter itself has no
    // local binary to probe.  Returning true means "this adapter is selectable".
    return true
  }

  async deploy(req: PreviewDeployRequest): Promise<PreviewResult> {
    return {
      url: null,
      provider: this.provider,
      deployedAt: new Date().toISOString(),
      requiresSecretGrant: false,
      meta: {
        project: req.projectName,
        note:
          'GitHub Pages is static-only.  This adapter does not push directly; configure a repo workflow ' +
          '(e.g. peaceiris/actions-gh-pages) to publish the output dir.  The release pipeline records this ' +
          'result so the dashboard can surface that external preview is unavailable via gh-pages.',
      },
      error: 'github-pages: external preview unavailable — configure a CI workflow to publish statically.',
    }
  }
}
