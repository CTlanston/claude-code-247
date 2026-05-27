import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { loadSuite, refuseResponse, verdict } from './index.js'

const SUITE_PATH = path.join(__dirname, '..', 'redteam', 'prompts.json')

describe('security · redteam suite (Stage L L1)', () => {
  it('case 1: workbook target — 30 prompts shipped', async () => {
    const suite = await loadSuite(SUITE_PATH)
    expect(suite.prompts.length).toBe(30)
  })

  it('case 2: every prompt has a non-empty regex', async () => {
    const suite = await loadSuite(SUITE_PATH)
    for (const p of suite.prompts) {
      expect(typeof p.unsafe_pattern).toBe('string')
      expect(p.unsafe_pattern.length).toBeGreaterThan(0)
      expect(() => new RegExp(p.unsafe_pattern)).not.toThrow()
    }
  })

  it('case 3: refuseResponse() does NOT trigger any unsafe pattern (0/30 leak)', async () => {
    const suite = await loadSuite(SUITE_PATH)
    const resp = refuseResponse()
    const leaked = suite.prompts.filter((p) => verdict(p, resp).responseLeaked)
    expect(leaked).toEqual([])
  })

  it('case 4: a worst-case "echo back" response correctly classifies as leaked', async () => {
    const suite = await loadSuite(SUITE_PATH)
    // A Coder that just echoes the unsafe pattern would fail every check.
    let leakedCount = 0
    for (const p of suite.prompts) {
      // construct a string matching the pattern by sampling one of the safest
      // unambiguous tokens from each regex; here we just feed in the literal
      // input — that hits patterns whose regex matches the input itself.
      if (verdict(p, p.input).responseLeaked) leakedCount++
    }
    // Most prompts have a pattern that matches their own input; we should see
    // a substantial fraction trip. The exact number isn't a guarantee — what
    // matters is that the matcher discriminates between a refusal and a leak.
    expect(leakedCount).toBeGreaterThan(0)
  })

  it('case 5: categories cover the major attack classes', async () => {
    const suite = await loadSuite(SUITE_PATH)
    const cats = new Set(suite.prompts.map((p) => p.category))
    expect(cats.size).toBeGreaterThanOrEqual(10)
    for (const must of ['secret_exfil', 'forbidden_path', 'prompt_injection', 'approval_bypass', 'destructive_git']) {
      expect(cats.has(must)).toBe(true)
    }
  })

  it('case 6: prompt ids are unique', async () => {
    const suite = await loadSuite(SUITE_PATH)
    const ids = suite.prompts.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
