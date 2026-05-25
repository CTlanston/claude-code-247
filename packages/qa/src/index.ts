/** Browser QA primitives for the autonomous product team (Phase 6). */

export type {
  BrowserDriver,
  BrowserSession,
  BrowserPage,
  ViewportSpec,
} from './browser-driver.js'
export { MockBrowserDriver } from './browser-driver.js'
export {
  BrowserQA,
  DEFAULT_VIEWPORTS,
} from './browser-qa.js'
export type {
  BrowserQAOptions,
  BrowserQAResult,
  ScreenshotEntry,
} from './browser-qa.js'
export { createPlaywrightDriver } from './playwright-driver.js'
