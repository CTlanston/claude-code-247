import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GUARDRAILS,
  GuardrailViolation,
  assertPathAllowed,
  assertHostAllowed,
  assertPidAllowed,
  type ChaosGuardrails,
} from './index.js'

describe('chaos · guardrails (Stage I L3 protection)', () => {
  const enabled: ChaosGuardrails = { ...DEFAULT_GUARDRAILS, realEffectsEnabled: true }

  it('case 1: realEffectsEnabled=false rejects every assertion', () => {
    expect(() => assertPathAllowed('/tmp/foo', DEFAULT_GUARDRAILS)).toThrow(GuardrailViolation)
    expect(() => assertHostAllowed('127.0.0.1', DEFAULT_GUARDRAILS)).toThrow(GuardrailViolation)
    expect(() => assertPidAllowed(99999, DEFAULT_GUARDRAILS)).toThrow(GuardrailViolation)
  })

  it('case 2: enabled + allowed tmp path passes', () => {
    expect(() => assertPathAllowed('/tmp/chaos-fill-1', enabled)).not.toThrow()
    expect(() => assertPathAllowed('/var/folders/abc/T/chaos-x', enabled)).not.toThrow()
  })

  it('case 3: enabled but path outside allowedPrefixes rejected', () => {
    expect(() => assertPathAllowed('/etc/hosts', enabled)).toThrow(/outside allowedTargetPrefixes/)
    expect(() => assertPathAllowed('/Users/lanston/projects/claude-code-247', enabled)).toThrow(/outside allowedTargetPrefixes/)
  })

  it('case 4: paranoid check — never touch ~/.claude-code-247 even via tmp symlink', () => {
    const oldHome = process.env.HOME
    process.env.HOME = '/Users/lanston'
    try {
      // suppose a malicious prefix slipped in
      const malicious: ChaosGuardrails = {
        ...enabled,
        allowedTargetPrefixes: ['/Users/'],
      }
      expect(() =>
        assertPathAllowed('/Users/lanston/.claude-code-247/state/claude247.db', malicious),
      ).toThrow(/targets ~\/\.claude-code-247/)
    } finally {
      process.env.HOME = oldHome
    }
  })

  it('case 5: host not in allowedHostnames rejected', () => {
    expect(() => assertHostAllowed('attacker.example.com', enabled)).toThrow(/not in allowedHostnames/)
    expect(() => assertHostAllowed('127.0.0.1', enabled)).not.toThrow()
  })

  it('case 6: pid 1 (init) and self pid always refused', () => {
    expect(() => assertPidAllowed(1, enabled)).toThrow(/init/)
    expect(() => assertPidAllowed(process.pid, enabled)).toThrow(/self/)
  })

  it('case 7: explicit pidWhitelist gates SIGKILL targets', () => {
    const gated: ChaosGuardrails = { ...enabled, pidWhitelist: [12345, 67890] }
    expect(() => assertPidAllowed(12345, gated)).not.toThrow()
    expect(() => assertPidAllowed(99999, gated)).toThrow(/not in pidWhitelist/)
  })

  it('case 8: default guardrails block every real effect at startup', () => {
    expect(DEFAULT_GUARDRAILS.realEffectsEnabled).toBe(false)
    expect(DEFAULT_GUARDRAILS.allowedHostnames).toContain('127.0.0.1')
    expect(DEFAULT_GUARDRAILS.allowedTargetPrefixes.some((p) => p.startsWith('/tmp'))).toBe(true)
  })
})
