import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { BrowserDriver, ViewportSpec } from './browser-driver.js'

/**
 * Browser-driven QA: multi-viewport screenshot capture, a layout-overlap
 * probe, and an a11y smoke probe.  Designed to plug into Phase 5's QA role
 * — when a mission requires UI, the QA role calls BrowserQA.run(url) and
 * writes the resulting screenshot-report.md into the evidence bundle.
 */
export const DEFAULT_VIEWPORTS: ViewportSpec[] = [
  { name: 'mobile', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]

export interface BrowserQAOptions {
  viewports?: ViewportSpec[]
  /** Where to write screenshots + the report.  Caller is responsible for ensuring this dir is task-scoped. */
  outputDir: string
}

export interface ScreenshotEntry {
  viewport: string
  width: number
  height: number
  path: string
  bytes: number
}

export interface BrowserQAResult {
  url: string
  screenshots: ScreenshotEntry[]
  layoutPassed: boolean
  layoutIssues: string[]
  a11yPassed: boolean
  a11yIssues: string[]
  reportPath: string
  passed: boolean
}

const LAYOUT_OVERLAP_SCRIPT = `
  // Minimal overlap probe: returns visible elements whose bounding boxes overlap by ≥ 50%.
  (() => {
    const elements = Array.from(document.body.querySelectorAll('*'))
      .filter((e) => e instanceof HTMLElement && e.offsetWidth > 0 && e.offsetHeight > 0)
      .map((e) => {
        const r = e.getBoundingClientRect()
        return { el: e, tag: e.tagName.toLowerCase(), id: e.id || '', cls: String(e.className || '').slice(0, 48), left: r.left, top: r.top, right: r.right, bottom: r.bottom, area: Math.max(0, r.width * r.height) }
      })
      .filter((r) => r.area > 400 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight)
    const overlaps = []
    const label = (r) => r.id ? '#' + r.id : r.cls ? r.tag + '.' + r.cls.split(/\\s+/).filter(Boolean).join('.') : r.tag
    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i], b = elements[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        const area = x * y
        if (area <= 0) continue
        const ratio = area / Math.min(a.area, b.area)
        if (ratio >= 0.5) overlaps.push({ a: label(a), b: label(b), ratio })
        if (overlaps.length >= 20) return { overlaps }
      }
    }
    return { overlaps }
  })()
`

const A11Y_SMOKE_SCRIPT = `
  // a11y smoke: missing alt on images, button without accessible name, low-contrast (deferred).
  (() => {
    const issues = []
    document.querySelectorAll('img:not([alt])').forEach((img) => issues.push({ kind: 'img-missing-alt', selector: img.tagName }))
    document.querySelectorAll('button:empty:not([aria-label])').forEach((btn) => issues.push({ kind: 'button-no-accessible-name' }))
    return { issues }
  })()
`

export class BrowserQA {
  private readonly viewports: ViewportSpec[]
  private readonly outputDir: string

  constructor(
    private readonly driver: BrowserDriver,
    opts: BrowserQAOptions,
  ) {
    this.viewports = opts.viewports ?? DEFAULT_VIEWPORTS
    this.outputDir = opts.outputDir
  }

  /**
   * Capture screenshots at every configured viewport, run the layout/a11y
   * probes once on the desktop viewport, write the per-viewport PNGs and
   * the screenshot-report.md, and return the structured result.
   */
  async run(url: string): Promise<BrowserQAResult> {
    mkdirSync(this.outputDir, { recursive: true })

    const session = await this.driver.launch()
    const screenshots: ScreenshotEntry[] = []
    let layoutIssues: string[] = []
    let a11yIssues: string[] = []
    try {
      for (const v of this.viewports) {
        const page = await session.newPage()
        try {
          await page.setViewport({ width: v.width, height: v.height })
          await page.navigate(url)
          const buf = await page.screenshot()
          const filePath = join(this.outputDir, `screenshot-${v.name}.png`)
          writeFileSync(filePath, buf)
          screenshots.push({ viewport: v.name, width: v.width, height: v.height, path: filePath, bytes: buf.length })
          if (v.name === 'desktop') {
            const layout = await page.evaluate<{ overlaps?: Array<{ a?: string; b?: string }> }>(LAYOUT_OVERLAP_SCRIPT)
            layoutIssues = (layout.overlaps ?? []).map((o) => `overlap between ${o.a ?? '?'} and ${o.b ?? '?'}`)
            const a11y = await page.evaluate<{ issues?: Array<{ kind?: string; selector?: string }> }>(A11Y_SMOKE_SCRIPT)
            a11yIssues = (a11y.issues ?? []).map((i) => `${i.kind ?? 'unknown'}${i.selector ? ` (${i.selector})` : ''}`)
          }
        } finally {
          await page.close()
        }
      }
    } finally {
      await session.close()
    }

    const layoutPassed = layoutIssues.length === 0
    const a11yPassed = a11yIssues.length === 0
    const passed = screenshots.length === this.viewports.length && layoutPassed && a11yPassed

    const reportPath = join(this.outputDir, 'screenshot-report.md')
    const reportMd = renderReport({ url, screenshots, layoutPassed, layoutIssues, a11yPassed, a11yIssues, passed })
    writeFileSync(reportPath, reportMd)

    return { url, screenshots, layoutPassed, layoutIssues, a11yPassed, a11yIssues, reportPath, passed }
  }
}

function renderReport(r: Omit<BrowserQAResult, 'reportPath'>): string {
  const lines: string[] = [
    `# Screenshot Report`,
    ``,
    `**URL:** ${r.url}`,
    `**Captured:** ${new Date().toISOString()}`,
    `**Overall:** ${r.passed ? '✅ pass' : '⚠️ fail'}`,
    ``,
    `## Captured viewports`,
  ]
  for (const s of r.screenshots) {
    lines.push(`- **${s.viewport}** (${s.width}×${s.height}) — \`${s.path}\` (${s.bytes} bytes)`)
  }
  if (r.screenshots.length === 0) lines.push('- (none captured)')
  lines.push('')
  lines.push('## Layout overlap probe')
  lines.push(r.layoutPassed ? '- ✅ no overlaps detected' : '- ⚠️ issues:')
  for (const i of r.layoutIssues) lines.push(`  - ${i}`)
  lines.push('')
  lines.push('## a11y smoke')
  lines.push(r.a11yPassed ? '- ✅ no a11y issues detected' : '- ⚠️ issues:')
  for (const i of r.a11yIssues) lines.push(`  - ${i}`)
  lines.push('')
  return lines.join('\n')
}
