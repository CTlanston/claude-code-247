/**
 * Phase 6 / Phase 8 — extended MergePolicy gates that inspect the evidence
 * bundle.  Verifies the original signature still works and the new optional
 * `MergePolicyEvidence` arg adds the screenshot / preview / secret-scan /
 * forbidden-path / sensitive-lane gates.
 */
import { describe, it, expect } from 'vitest'
import type { ValidatorResult } from '@aedev/core'
import { MergePolicy } from './merge-policy.js'

function pass(name: 'gemini' | 'openai'): ValidatorResult {
  return {
    id: name + '-id',
    taskId: 't',
    runId: 'r',
    validator: name,
    verdict: 'pass',
    createdAt: new Date().toISOString(),
  }
}

const TWO_PASSES = [pass('gemini'), pass('openai')]

describe('MergePolicy — original signature unchanged', () => {
  it('AUTO_MERGE on low risk + dual pass + no extra evidence', () => {
    const p = new MergePolicy()
    expect(p.decide(10, TWO_PASSES)).toBe('AUTO_MERGE')
  })

  it('WAITING with single validator (unchanged)', () => {
    const p = new MergePolicy()
    expect(p.decide(10, [pass('gemini')])).toBe('WAITING')
  })

  it('BLOCKED at high risk (unchanged)', () => {
    const p = new MergePolicy()
    expect(p.decide(70, TWO_PASSES)).toBe('BLOCKED')
  })
})

describe('MergePolicy — UI screenshot gate', () => {
  it('WAITING when requiresScreenshots and no screenshot evidence', () => {
    const p = new MergePolicy()
    expect(p.decide(10, TWO_PASSES, { requiresScreenshots: true })).toBe('WAITING')
    expect(p.decide(10, TWO_PASSES, { requiresScreenshots: true, bundle: {} })).toBe('WAITING')
  })

  it('WAITING when screenshot-report exists but is the Phase-5 stub (status: Pending)', () => {
    const p = new MergePolicy()
    expect(
      p.decide(10, TWO_PASSES, {
        requiresScreenshots: true,
        bundle: { 'screenshot-report.md': '# Screenshot Report\n**Status:** Pending' },
      }),
    ).toBe('WAITING')
  })

  it('AUTO_MERGE when screenshot-report references real PNGs', () => {
    const p = new MergePolicy()
    const bundle = {
      'screenshot-report.md': '# Screenshot Report\n\n- screenshot-mobile.png (1234 bytes)',
    }
    expect(p.decide(10, TWO_PASSES, { requiresScreenshots: true, bundle })).toBe('AUTO_MERGE')
  })
})

describe('MergePolicy — preview gate', () => {
  it('WAITING when requiresPreview and no preview-url.txt', () => {
    const p = new MergePolicy()
    expect(p.decide(10, TWO_PASSES, { requiresPreview: true, bundle: {} })).toBe('WAITING')
  })

  it('WAITING when preview-url.txt is not an http(s) URL', () => {
    const p = new MergePolicy()
    expect(
      p.decide(10, TWO_PASSES, {
        requiresPreview: true,
        bundle: { 'preview-url.txt': 'preview pending' },
      }),
    ).toBe('WAITING')
  })

  it('AUTO_MERGE when preview-url.txt has a valid URL', () => {
    const p = new MergePolicy()
    expect(
      p.decide(10, TWO_PASSES, {
        requiresPreview: true,
        bundle: { 'preview-url.txt': 'https://my-pr-123.pages.dev' },
      }),
    ).toBe('AUTO_MERGE')
  })
})

describe('MergePolicy — safety gates', () => {
  it('BLOCKED on secret-scan hit regardless of validators', () => {
    const p = new MergePolicy()
    expect(p.decide(10, TWO_PASSES, { secretScanHit: true })).toBe('BLOCKED')
  })

  it('BLOCKED on forbidden-path touch', () => {
    const p = new MergePolicy()
    expect(p.decide(10, TWO_PASSES, { forbiddenPathTouched: true })).toBe('BLOCKED')
  })

  it('WAITING on sensitive lane even with low risk + dual pass', () => {
    const p = new MergePolicy()
    expect(p.decide(10, TWO_PASSES, { sensitiveLane: true })).toBe('WAITING')
  })
})
