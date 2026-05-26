/**
 * Browser driver abstraction.  Phase 6 ships with a deterministic
 * `MockBrowserDriver` (used in tests) and a recipe for wiring Playwright via
 * `createPlaywrightDriver()` at runtime — but the @aedev/qa package does NOT
 * depend on Playwright directly.  Consumers install Playwright themselves
 * when they need real browser capture, keeping the default install light.
 */

export interface ViewportSpec {
  name: string
  width: number
  height: number
}

export interface BrowserPage {
  navigate(url: string): Promise<void>
  setViewport(viewport: { width: number; height: number }): Promise<void>
  screenshot(): Promise<Buffer>
  evaluate<T = unknown>(script: string): Promise<T>
  close(): Promise<void>
}

export interface BrowserSession {
  newPage(): Promise<BrowserPage>
  close(): Promise<void>
}

export interface BrowserDriver {
  launch(): Promise<BrowserSession>
}

/**
 * Deterministic in-memory driver for tests and offline development.  Each
 * "screenshot" is a tiny PNG header (8 bytes) so consumers can still write
 * the file and assert its presence.
 */
export class MockBrowserDriver implements BrowserDriver {
  constructor(
    private readonly opts: {
      /** Pre-canned evaluate results keyed by script substring. */
      evaluateMap?: Record<string, unknown>
      /** Pre-canned screenshot buffer.  Default: a tiny PNG-magic-bytes blob. */
      screenshot?: Buffer
      /** Pages that fail to navigate.  Used to test failure paths. */
      navigateFailures?: Set<string>
    } = {},
  ) {}

  async launch(): Promise<BrowserSession> {
    const evaluateMap = this.opts.evaluateMap ?? {}
    const png = this.opts.screenshot ?? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const navigateFailures = this.opts.navigateFailures ?? new Set<string>()
    return {
      newPage: async () => {
        let viewport = { width: 1280, height: 800 }
        return {
          navigate: async (url: string): Promise<void> => {
            if (navigateFailures.has(url)) {
              throw new Error(`mock navigate failed for ${url}`)
            }
          },
          setViewport: async (v): Promise<void> => { viewport = v },
          screenshot: async () => png,
          evaluate: async <T = unknown>(script: string): Promise<T> => {
            for (const key of Object.keys(evaluateMap)) {
              if (script.includes(key)) return evaluateMap[key] as T
            }
            // Default: a layout-safe "no overlaps, no a11y issues" payload.
            if (script.includes('overlap')) return ({ overlaps: [] }) as unknown as T
            if (script.includes('a11y') || script.includes('accessibility')) return ({ issues: [] }) as unknown as T
            void viewport
            return ({}) as T
          },
          close: async () => {},
        }
      },
      close: async () => {},
    }
  }
}
