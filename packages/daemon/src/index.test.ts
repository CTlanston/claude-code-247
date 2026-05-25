import { describe, it, expect } from 'vitest'
import { DAEMON_NAME, DEFAULT_PORT } from './index.js'

describe('daemon', () => {
  it('has the correct daemon name', () => {
    expect(DAEMON_NAME).toBe('aedev-daemon')
  })

  it('uses port 7247', () => {
    expect(DEFAULT_PORT).toBe(7247)
  })
})
