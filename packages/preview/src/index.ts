/** External preview deployment adapters (Phase 7). */

export type {
  PreviewAdapter,
  PreviewDeployRequest,
  PreviewResult,
  PreviewProvider,
} from './preview-adapter.js'
export { CloudflarePagesAdapter } from './cloudflare-pages-adapter.js'
export type { CloudflarePagesAdapterOptions } from './cloudflare-pages-adapter.js'
export { VercelAdapter } from './vercel-adapter.js'
export type { VercelAdapterOptions } from './vercel-adapter.js'
export { GitHubPagesAdapter } from './github-pages-adapter.js'
