import { describe, it, expect } from 'vitest'
import { CLI_NAME, CLI_VERSION } from './index.js'

describe('cli', () => {
  it('has the correct CLI name', () => {
    expect(CLI_NAME).toBe('aedev')
  })

  it('has a version', () => {
    expect(CLI_VERSION).toBe('0.0.1')
  })
})
