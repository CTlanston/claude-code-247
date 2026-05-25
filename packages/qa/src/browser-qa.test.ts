import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MockBrowserDriver } from './browser-driver.js'
import { BrowserQA, DEFAULT_VIEWPORTS } from './browser-qa.js'

let outputDir: string

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), 'aedev-browser-qa-test-'))
})

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true })
})

describe('BrowserQA — default mock driver (happy path)', () => {
  it('captures one screenshot per default viewport', async () => {
    const qa = new BrowserQA(new MockBrowserDriver(), { outputDir })
    const result = await qa.run('https://example.com')

    expect(result.screenshots).toHaveLength(DEFAULT_VIEWPORTS.length)
    for (const v of DEFAULT_VIEWPORTS) {
      const entry = result.screenshots.find((s) => s.viewport === v.name)
      expect(entry).toBeDefined()
      expect(entry?.width).toBe(v.width)
      expect(entry?.height).toBe(v.height)
      expect(existsSync(entry?.path ?? '')).toBe(true)
      expect(statSync(entry?.path ?? '').size).toBeGreaterThan(0)
    }
  })

  it('writes a screenshot-report.md that references every viewport PNG', async () => {
    const qa = new BrowserQA(new MockBrowserDriver(), { outputDir })
    const result = await qa.run('https://example.com/landing')

    expect(result.reportPath).toBe(join(outputDir, 'screenshot-report.md'))
    const md = readFileSync(result.reportPath, 'utf-8')
    expect(md).toContain('https://example.com/landing')
    expect(md).toContain('mobile')
    expect(md).toContain('tablet')
    expect(md).toContain('desktop')
    expect(md).toContain('screenshot-mobile.png')
    expect(md).toContain('screenshot-tablet.png')
    expect(md).toContain('screenshot-desktop.png')
  })

  it('marks overall pass when layout + a11y probes return clean', async () => {
    const qa = new BrowserQA(new MockBrowserDriver(), { outputDir })
    const result = await qa.run('https://example.com')
    expect(result.layoutPassed).toBe(true)
    expect(result.a11yPassed).toBe(true)
    expect(result.passed).toBe(true)
  })
})

describe('BrowserQA — failure paths', () => {
  it('surfaces layout overlap findings into the report and marks not-passed', async () => {
    const driver = new MockBrowserDriver({
      evaluateMap: {
        overlap: { overlaps: [{ a: 'header', b: 'cta-button' }] },
      },
    })
    const qa = new BrowserQA(driver, { outputDir })
    const result = await qa.run('https://example.com')

    expect(result.layoutPassed).toBe(false)
    expect(result.layoutIssues[0]).toContain('overlap')
    expect(result.passed).toBe(false)
    const md = readFileSync(result.reportPath, 'utf-8')
    expect(md).toContain('overlap')
    expect(md).toContain('⚠️ fail')
  })

  it('surfaces a11y issues into the report and marks not-passed', async () => {
    const driver = new MockBrowserDriver({
      evaluateMap: {
        a11y: { issues: [{ kind: 'img-missing-alt', selector: 'IMG' }] },
      },
    })
    const qa = new BrowserQA(driver, { outputDir })
    const result = await qa.run('https://example.com')

    expect(result.a11yPassed).toBe(false)
    expect(result.a11yIssues[0]).toContain('img-missing-alt')
    expect(result.passed).toBe(false)
  })

  it('propagates navigate failures from the driver', async () => {
    const driver = new MockBrowserDriver({ navigateFailures: new Set(['https://broken.example']) })
    const qa = new BrowserQA(driver, { outputDir })
    await expect(qa.run('https://broken.example')).rejects.toThrow(/mock navigate failed/)
  })
})

describe('BrowserQA — custom viewports', () => {
  it('honors a custom viewport list', async () => {
    const qa = new BrowserQA(new MockBrowserDriver(), {
      outputDir,
      viewports: [
        { name: 'pixel', width: 412, height: 915 },
        { name: '4k', width: 3840, height: 2160 },
      ],
    })
    const result = await qa.run('https://example.com')
    expect(result.screenshots.map((s) => s.viewport)).toEqual(['pixel', '4k'])
  })
})
