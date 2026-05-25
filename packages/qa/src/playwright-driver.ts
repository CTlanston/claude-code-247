import type { BrowserDriver, BrowserSession, BrowserPage } from './browser-driver.js'

/**
 * Factory that creates a Playwright-backed BrowserDriver via dynamic import.
 * The @aedev/qa package deliberately does NOT depend on Playwright — install
 * it in the consuming project when you need real browser capture:
 *
 *   pnpm add -D playwright
 *   pnpm dlx playwright install chromium
 *
 * Then:
 *   const driver = await createPlaywrightDriver()
 *   const qa = new BrowserQA(driver, { outputDir: './evidence/screens' })
 *
 * If Playwright is not installed, this function throws a descriptive error
 * so callers can surface a clear "install playwright" instruction.
 */
export async function createPlaywrightDriver(opts: { browser?: 'chromium' | 'firefox' | 'webkit' } = {}): Promise<BrowserDriver> {
  const browserName = opts.browser ?? 'chromium'
  let playwright: { chromium?: { launch(): Promise<unknown> }; firefox?: { launch(): Promise<unknown> }; webkit?: { launch(): Promise<unknown> } }
  try {
    // Dynamic import keeps playwright optional.  If not installed, the catch
    // below converts the loader error into an actionable message.
    playwright = (await import('playwright' as string)) as typeof playwright
  } catch (e) {
    throw new Error(
      `@aedev/qa: playwright is not installed.  Install it with \`pnpm add -D playwright && pnpm dlx playwright install chromium\` ` +
      `before calling createPlaywrightDriver().  Underlying error: ${(e as Error).message}`,
    )
  }

  return {
    launch: async (): Promise<BrowserSession> => {
      const launcher = playwright[browserName]
      if (!launcher) {
        throw new Error(`@aedev/qa: playwright does not expose '${browserName}' on this version.`)
      }
      const browser = (await launcher.launch()) as {
        newContext(): Promise<{
          newPage(): Promise<{
            goto(url: string): Promise<unknown>
            setViewportSize(v: { width: number; height: number }): Promise<unknown>
            screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>
            evaluate(script: string): Promise<unknown>
            close(): Promise<unknown>
          }>
          close(): Promise<unknown>
        }>
        close(): Promise<unknown>
      }
      const context = await browser.newContext()
      return {
        newPage: async (): Promise<BrowserPage> => {
          const page = await context.newPage()
          return {
            navigate: async (url) => { await page.goto(url) },
            setViewport: async (v) => { await page.setViewportSize(v) },
            screenshot: async () => page.screenshot({ fullPage: true }),
            evaluate: async <T = unknown>(script: string) => (await page.evaluate(script)) as T,
            close: async () => { await page.close() },
          }
        },
        close: async () => {
          await context.close()
          await browser.close()
        },
      }
    },
  }
}
