import { describe, expect, it } from 'vitest'
import { assertDifferentFamily, FamilyConflictError } from './family-enforce.js'

describe('assertDifferentFamily', () => {
  it('throws synchronously when reviewer and validator use the same real family', () => {
    expect(() => assertDifferentFamily('google', 'google')).toThrow(FamilyConflictError)
  })

  it('allows different families and mock tests', () => {
    expect(() => assertDifferentFamily('google', 'openai')).not.toThrow()
    expect(() => assertDifferentFamily('mock', 'mock')).not.toThrow()
  })
})
