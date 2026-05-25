import { describe, it, expect } from 'vitest'
import { validateTaskTransition, validateMissionTransition } from './state-machine.js'

describe('validateTaskTransition', () => {
  it('allows pending → running', () => expect(() => validateTaskTransition('pending', 'running')).not.toThrow())
  it('allows running → done', () => expect(() => validateTaskTransition('running', 'done')).not.toThrow())
  it('allows failed → pending (retry)', () => expect(() => validateTaskTransition('failed', 'pending')).not.toThrow())
  it('blocks done → anything', () => expect(() => validateTaskTransition('done', 'pending')).toThrow())
  it('blocks pending → done (skip running)', () => expect(() => validateTaskTransition('pending', 'done')).toThrow())
})

describe('validateMissionTransition', () => {
  it('allows draft → pending_approval', () => expect(() => validateMissionTransition('draft', 'pending_approval')).not.toThrow())
  it('allows pending_approval → approved', () => expect(() => validateMissionTransition('pending_approval', 'approved')).not.toThrow())
  it('blocks draft → running', () => expect(() => validateMissionTransition('draft', 'running')).toThrow())
  it('blocks done → anything', () => expect(() => validateMissionTransition('done', 'approved')).toThrow())
})
